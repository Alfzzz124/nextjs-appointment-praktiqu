<?php

namespace KCProApp\baseClasses;

use Exception;
use KCProApp\models\KCProFollowupChain;
use KCProApp\baseClasses\KCProFollowupSettings;

defined('ABSPATH') or die('Something went wrong');

class KCProChainService
{
    /**
     * @var KCProChainService|null
     */
    private static $instance = null;

    public static function get_instance(): KCProChainService
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Create or retrieve active chain.
     *
     * Behaviour is controlled by the treatment_chain_settings:
     *   - allow_multiple_active = false (default): enforces exactly 1 active chain
     *     per patient/diagnosis combination (original behaviour).
     *   - allow_multiple_active = true: always creates a new chain, allowing
     *     several active chains on the same patient simultaneously.
     *
     * If Treatment Chains are disabled globally, an Exception is thrown so the
     * caller can surface a clear error to the API consumer.
     *
     * @param int $clinicId
     * @param int $patientId
     * @param int $doctorId
     * @param int|null $diagnosisId
     * @param string|null $chainName
     * @return int Chain ID
     * @throws Exception
     */
    public function getOrCreateActiveChain(int $clinicId, int $patientId, int $doctorId, ?int $diagnosisId = null, ?string $chainName = null): int
    {
        // Respect global chain module toggle
        if (!KCProFollowupSettings::isChainsEnabled()) {
            throw new Exception('Treatment Chains are disabled in system configuration.');
        }

        // When multiple active chains per patient are NOT allowed (strict mode),
        // look for an existing active chain and reuse it.
        if (!KCProFollowupSettings::allowMultipleActive()) {
            $query = KCProFollowupChain::query()
                ->where('patient_id', $patientId)
                ->where('status', 'active');

            if ($diagnosisId !== null) {
                $query->where('diagnosis_id', $diagnosisId);
            } else {
                $query->whereNull('diagnosis_id');
            }

            $existingChain = $query->first();
            if ($existingChain) {
                return (int) $existingChain->id;
            }
        }
        // When allow_multiple_active = true we skip the lookup and always
        // fall through to create a brand-new chain below.

        // Create a new chain
        $utcNow = gmdate('Y-m-d H:i:s');
        $chainData = [
            'clinic_id'    => $clinicId,
            'patient_id'   => $patientId,
            'doctor_id'    => $doctorId,
            'diagnosis_id' => $diagnosisId,
            'name'         => $chainName,
            'status'       => 'active',
            'created_at_utc' => $utcNow,
        ];

        $chainId = KCProFollowupChain::create($chainData);
        if (is_wp_error($chainId) || !$chainId) {
            throw new Exception('Failed to generate root follow-up chain.');
        }

        KCProChainAuditService::get_instance()->log(
            (int) $chainId,
            null,
            'chain_created',
            null,
            $chainData
        );

        return (int) $chainId;
    }
}
