<?php

namespace App\Services;

// Padanan ApiError di lib/api.js FE lama: membawa status HTTP dan body
// terurai supaya pemanggil bisa membedakan 401/409/429 dst.
class ApiException extends \RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $status = 0,
        public readonly mixed $body = null,
    ) {
        parent::__construct($message, $status);
    }
}
