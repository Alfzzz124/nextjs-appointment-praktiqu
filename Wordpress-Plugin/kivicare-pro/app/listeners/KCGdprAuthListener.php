<?php

namespace KCProApp\listeners;

use KCProApp\services\KCGdprAuditService;

defined('ABSPATH') or die('Something went wrong');

class KCGdprAuthListener
{
    public static function logLogin($userLogin, $user)
    {
        try {
            if (!$user) {
                return;
            }

            KCGdprAuditService::log(
                'login',
                $user->ID,
                'user',
                $user->ID,
                'login',
                [
                    'username'    => sanitize_text_field((string) $userLogin),
                    'action_hook' => 'wp_login',
                ],
                (int) $user->ID
            );
        } catch (\Throwable $e) {
            error_log('GDPR Auth Listener Login Error: ' . $e->getMessage());
        }
    }

    public static function logLogout($userId)
    {
        try {
            if (!$userId) {
                return;
            }

            $user     = get_user_by('id', $userId);
            $username = $user ? $user->user_login : 'Unknown';
            KCGdprAuditService::log(
                'logout',
                $userId,
                'user',
                $userId,
                'logout',
                [
                    'username'    => sanitize_text_field((string) $username),
                    'action_hook' => 'wp_logout',
                ],
                (int) $userId
            );
        } catch (\Throwable $e) {
            error_log('GDPR Auth Listener Logout Error: ' . $e->getMessage());
        }
    }

    public static function logLoginFailed($username, $error = null)
    {
        try {
            $user   = get_user_by('login', $username);
            $userId = $user ? $user->ID : null;

            if (!$userId && is_email($username)) {
                $userByEmail = get_user_by('email', $username);
                $userId      = $userByEmail ? $userByEmail->ID : null;
            }

            $errorCode    = '';
            $errorMessage = '';

            if ($error instanceof \WP_Error) {
                $errorCode    = (string) $error->get_error_code();
                $errorMessage = (string) $error->get_error_message($errorCode);
                if (empty($errorMessage)) {
                    $allMessages  = $error->get_error_messages();
                    $errorMessage = !empty($allMessages) ? (string) $allMessages[0] : '';
                }
            }

            // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized, WordPress.Security.ValidatedSanitizedInput.MissingUnslash
            $ipAddress = sanitize_text_field($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');

            $reason = 'authentication_failed';
            if ($errorCode === 'incorrect_password') {
                $reason = 'incorrect_password';
            } elseif ($errorCode === 'invalid_username') {
                $reason = 'invalid_username';
            } elseif ($errorCode === 'invalid_email') {
                $reason = 'invalid_email';
            }

            KCGdprAuditService::log(
                'login_failed',
                $userId,
                'user',
                $userId,
                'failed_login',
                [
                    'attempted_username' => sanitize_text_field($username),
                    'reason'             => $reason,
                    'error_message'      => sanitize_text_field($errorMessage),
                    'login_form'         => 'global_hook',
                    'ip_address'         => $ipAddress,
                ],
                $userId ? (int) $userId : null
            );
        } catch (\Throwable $e) {
            error_log('GDPR Auth Listener Login Failed Error: ' . $e->getMessage());
        }
    }
}
