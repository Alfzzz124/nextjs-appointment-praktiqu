<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;
use App\baseClasses\KCErrorLogger;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCServiceSession
 *
 * Model for service-based timeslot sessions stored in kc_service_sessions table.
 * Each record represents a session segment for a specific service-doctor-clinic mapping.
 * Breaks are represented as split segments using parent_id.
 *
 * @property int $id
 * @property int $mappingId  FK to kc_service_doctor_mapping.id
 * @property string|null $day  Day identifier: mon, tue, wed, thu, fri, sat, sun
 * @property string|null $startTime  Session segment start (HH:MM:SS)
 * @property string|null $endTime    Session segment end (HH:MM:SS)
 * @property int|null $parentId  Parent session id for split (break) segments
 */
class KCServiceSession extends KCBaseModel
{
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_service_sessions',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'mappingId' => [
                    'column' => 'mapping_id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'sanitizers' => ['intval'],
                ],
                'day' => [
                    'column' => 'day',
                    'type' => 'varchar',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'startTime' => [
                    'column' => 'start_time',
                    'type' => 'time',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'endTime' => [
                    'column' => 'end_time',
                    'type' => 'time',
                    'nullable' => true,
                    'sanitizers' => ['sanitize_text_field'],
                ],
                'parentId' => [
                    'column' => 'parent_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
            ],
            'timestamps' => false,
            'soft_deletes' => false,
        ];
    }

    /**
     * Format time string for database storage (HH:MM -> HH:MM:SS)
     */
    public static function formatTimeForDatabase(?string $time): ?string
    {
        if (empty($time)) {
            return null;
        }
        if (preg_match('/^\d{2}:\d{2}:\d{2}$/', $time)) {
            return $time;
        }
        if (preg_match('/^\d{2}:\d{2}$/', $time)) {
            return $time . ':00';
        }
        return null;
    }

    /**
     * Trim time string to HH:MM format for frontend consumption
     */
    public static function trimTime(?string $time): string
    {
        if (empty($time)) {
            return '';
        }
        return substr($time, 0, 5);
    }

    /**
     * Create service sessions for a specific mapping.
     *
     * For days without breaks: one row per day.
     * For days with breaks: multiple split rows per day — segments between/after breaks,
     * with parent_id pointing to the first segment of that day.
     *
     * @param int   $mapping_id
     * @param array $days  Array of day objects from frontend:
     *                     [{ id, enabled, main_session: {start, end}, breaks: [{start, end}] }]
     * @return array  Array of inserted session IDs
     * @throws \Exception
     */
    public static function createServiceSessions(int $mapping_id, array $days): array
    {
        global $wpdb;

        try {
            $wpdb->query('START TRANSACTION');

            $inserted = [];
            $enabled_days = array_filter($days, fn($d) => !empty($d['enabled']));

            $parent_id     = null;
            foreach ($enabled_days as $day) {
                $day_id       = sanitize_text_field($day['id'] ?? '');
                $main_session = $day['main_session'] ?? null;

                if (!$day_id || !$main_session || empty($main_session['start']) || empty($main_session['end'])) {
                    continue;
                }

                $breaks = array_filter($day['breaks'] ?? [], fn($b) => !empty($b['start']) && !empty($b['end']));
                $breaks = array_values($breaks);

                if (empty($breaks)) {
                    // No breaks — single row
                    $session_id = static::create([
                        'mappingId' => $mapping_id,
                        'day'       => $day_id,
                        'startTime' => static::formatTimeForDatabase($main_session['start']),
                        'endTime'   => static::formatTimeForDatabase($main_session['end']),
                        'parentId'  => $parent_id,
                    ]);
                    
                    // Track first session ID for consistency
                    if ($parent_id === null) {
                        $parent_id = $session_id;
                    }
                    
                    $inserted[] = $session_id;
                } else {
                    // Split sessions around breaks
                    $segment_start = $main_session['start'];

                    foreach ($breaks as $brk) {
                        // Segment before this break
                        $session_id = static::create([
                            'mappingId' => $mapping_id,
                            'day'       => $day_id,
                            'startTime' => static::formatTimeForDatabase($segment_start),
                            'endTime'   => static::formatTimeForDatabase($brk['start']),
                            'parentId'  => $parent_id,
                        ]);

                        if ($parent_id === null) {
                            $parent_id = $session_id;
                        }

                        $inserted[]    = $session_id;
                        $segment_start = $brk['end'];
                    }

                    // Final segment after last break
                    $session_id = static::create([
                        'mappingId' => $mapping_id,
                        'day'       => $day_id,
                        'startTime' => static::formatTimeForDatabase($segment_start),
                        'endTime'   => static::formatTimeForDatabase($main_session['end']),
                        'parentId'  => $parent_id,
                    ]);
                    $inserted[] = $session_id;
                }
            }

            $wpdb->query('COMMIT');

            return $inserted;
        } catch (\Exception $e) {
            $wpdb->query('ROLLBACK');
            KCErrorLogger::instance()->error('KCServiceSession::createServiceSessions Error: ' . $e->getMessage());
            throw $e;
        }
    }

    /**
     * Update service sessions for a mapping: delete all existing then recreate.
     *
     * @param int   $mapping_id
     * @param array $days
     * @return array  Array of inserted session IDs
     * @throws \Exception
     */
    public static function updateServiceSessions(int $mapping_id, array $days): array
    {
        // Delete existing sessions for this mapping
        $existing = static::query()->where('mappingId', $mapping_id)->get();
        foreach ($existing as $session) {
            $session->delete();
        }

        return static::createServiceSessions($mapping_id, $days);
    }

    /**
     * Get sessions for a mapping and reconstruct them as a structured days array.
     *
     * @param int $mapping_id
     * @return array  Array of day objects:
     *                [{ id, enabled, main_session: {start, end}, breaks: [{start, end}] }]
     */
    public static function getSessionsByMappingId(int $mapping_id): array
    {
        $sessions = static::query()
            ->where('mappingId', $mapping_id)
            ->orderBy('day')
            ->orderBy('start_time')
            ->get()
            ->toArray();

        if (empty($sessions)) {
            return [];
        }

        // Group segments by day
        $days_segments = [];
        foreach ($sessions as $session) {
            $day = $session->day;
            if (!isset($days_segments[$day])) {
                $days_segments[$day] = [];
            }
            $days_segments[$day][] = $session;
        }

        $result = [];

        foreach ($days_segments as $day_id => $segments) {
            if (count($segments) === 1) {
                // No breaks
                $result[] = [
                    'id'           => $day_id,
                    'enabled'      => true,
                    'main_session' => [
                        'start' => static::trimTime($segments[0]->startTime),
                        'end'   => static::trimTime($segments[0]->endTime),
                    ],
                    'breaks'       => [],
                ];
            } else {
                // Has breaks — reconstruct from split segments
                // Segments are ordered by start_time
                $main_start = static::trimTime($segments[0]->startTime);
                $main_end   = static::trimTime(end($segments)->endTime);

                $breaks = [];
                for ($i = 0; $i < count($segments) - 1; $i++) {
                    $breaks[] = [
                        'start' => static::trimTime($segments[$i]->endTime),
                        'end'   => static::trimTime($segments[$i + 1]->startTime),
                    ];
                }

                $result[] = [
                    'id'           => $day_id,
                    'enabled'      => true,
                    'main_session' => [
                        'start' => $main_start,
                        'end'   => $main_end,
                    ],
                    'breaks'       => $breaks,
                ];
            }
        }

        return $result;
    }

    /**
     * Delete all sessions for a mapping.
     *
     * @param int $mapping_id
     * @return int  Number of deleted rows
     */
    public static function deleteByMappingId(int $mapping_id): int
    {
        $sessions = static::query()->where('mappingId', $mapping_id)->get();
        $count    = 0;
        foreach ($sessions as $session) {
            $session->delete();
            $count++;
        }
        return $count;
    }
}
