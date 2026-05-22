<?php

namespace KCProApp\notifications\hydrators;

defined('ABSPATH') or die('Something went wrong');

interface KCNotificationContextHydratorInterface
{
    public function supports(array $context): bool;

    /**
     * @return array{recipients: array, data: array, options: array}|null
     */
    public function hydrate(string $templateName, array $context, array $options): ?array;
}
