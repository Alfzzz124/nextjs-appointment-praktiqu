<?php

namespace KCProApp\interfaces;

/**
 * Notification Channel Interface
 */
interface KCNotificationChannel
{
    public function send(array $recipients, string $subject, string $content, array $data = []): bool;
}
