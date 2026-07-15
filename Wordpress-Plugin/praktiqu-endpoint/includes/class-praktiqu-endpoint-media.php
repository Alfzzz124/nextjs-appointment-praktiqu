<?php
/**
 * Media — sideloads uploaded files into the WordPress media library.
 *
 * Called service-to-service by the Next.js app. There is NO logged-in user in
 * these requests, which is why this class sets its own `upload_dir` filter
 * instead of relying on KiviCare's KCMediaHandler: that filter only fires for
 * users holding a KiviCare role, so it would silently no-op here and files
 * would land in the default year/month folder.
 *
 * @package PraktiQU\Endpoint
 */

declare(strict_types=1);

namespace PraktiQU\Endpoint;

defined('ABSPATH') || exit;

final class Media
{
    /** Upload subfolder per context, relative to the uploads basedir. */
    private const SUBDIR_BY_CONTEXT = [
        'medical-report' => '/kivicare-reports',
        'custom-field'   => '/kivicare-uploads',
    ];

    private const DEFAULT_CONTEXT = 'custom-field';

    /**
     * Handle POST /praktiqu/v1/media.
     *
     * @return array|\WP_Error
     */
    public function sideload(\WP_REST_Request $request)
    {
        $files = $request->get_file_params();

        if (empty($files['file'])) {
            // A body that arrived but produced no $_FILES almost always means
            // PHP discarded it for exceeding post_max_size. Say so loudly —
            // otherwise this looks like "no file sent" and wastes hours.
            $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
            if ($length > 0) {
                return new \WP_Error(
                    'praktiqu_upload_body_dropped',
                    sprintf(
                        'Request carried %d bytes but PHP exposed no file. post_max_size=%s, upload_max_filesize=%s.',
                        $length,
                        (string) ini_get('post_max_size'),
                        (string) ini_get('upload_max_filesize')
                    ),
                    ['status' => 413]
                );
            }
            return new \WP_Error('praktiqu_no_file', 'No file provided.', ['status' => 400]);
        }

        $file = $files['file'];
        $error_code = isset($file['error']) ? (int) $file['error'] : UPLOAD_ERR_OK;
        if ($error_code !== UPLOAD_ERR_OK) {
            return new \WP_Error(
                'praktiqu_upload_error',
                $this->upload_error_message($error_code),
                ['status' => $error_code === UPLOAD_ERR_INI_SIZE || $error_code === UPLOAD_ERR_FORM_SIZE ? 413 : 400]
            );
        }

        $context = (string) ($request->get_param('context') ?? self::DEFAULT_CONTEXT);
        $subdir  = self::SUBDIR_BY_CONTEXT[$context] ?? self::SUBDIR_BY_CONTEXT[self::DEFAULT_CONTEXT];

        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        $filter = static function (array $uploads) use ($subdir): array {
            $uploads['path']   = $uploads['basedir'] . $subdir;
            $uploads['url']    = $uploads['baseurl'] . $subdir;
            $uploads['subdir'] = ''; // flat: no year/month nesting
            if (!file_exists($uploads['path'])) {
                wp_mkdir_p($uploads['path']);
            }
            return $uploads;
        };

        add_filter('upload_dir', $filter);
        try {
            // media_handle_upload (not sideload) is correct here: the file is a
            // genuine PHP upload in $_FILES, so it must be moved with
            // move_uploaded_file. test_form => false because there is no
            // wp-admin form nonce in a service-to-service request.
            $attachment_id = media_handle_upload('file', 0, [], ['test_form' => false]);
        } finally {
            remove_filter('upload_dir', $filter);
        }

        if (is_wp_error($attachment_id)) {
            return new \WP_Error(
                'praktiqu_sideload_failed',
                $attachment_id->get_error_message(),
                ['status' => 400]
            );
        }

        $attachment_id = (int) $attachment_id;
        $url = wp_get_attachment_url($attachment_id);

        return [
            'mediaId' => $attachment_id,
            'url'     => is_string($url) ? $url : '',
            'name'    => (string) get_the_title($attachment_id),
        ];
    }

    private function upload_error_message(int $code): string
    {
        switch ($code) {
            case UPLOAD_ERR_INI_SIZE:
                return sprintf('File exceeds the server upload_max_filesize (%s).', (string) ini_get('upload_max_filesize'));
            case UPLOAD_ERR_FORM_SIZE:
                return 'File exceeds the form-declared maximum size.';
            case UPLOAD_ERR_PARTIAL:
                return 'File was only partially uploaded.';
            case UPLOAD_ERR_NO_FILE:
                return 'No file was uploaded.';
            case UPLOAD_ERR_NO_TMP_DIR:
                return 'Server is missing a temporary folder.';
            case UPLOAD_ERR_CANT_WRITE:
                return 'Server failed to write the file to disk.';
            case UPLOAD_ERR_EXTENSION:
                return 'A PHP extension stopped the upload.';
            default:
                return 'Unknown upload error.';
        }
    }
}
