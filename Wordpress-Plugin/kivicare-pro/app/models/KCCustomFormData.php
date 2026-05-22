<?php

namespace KCProApp\models;

use App\baseClasses\KCBaseModel;

defined('ABSPATH') or die('Something went wrong');

/**
 * Class KCCustomFormData
 *
 * @property int $id
 * @property int|null $form_id
 * @property string|null $form_data
 * @property int|null $module_id
 * @property string|null $created_at
 * @property string|null $updated_at
 */
class KCCustomFormData extends KCBaseModel
{
    /**
     * Define table structure and properties
     */
    protected static function initSchema(): array
    {
        return [
            'table_name' => 'kc_custom_form_data',
            'primary_key' => 'id',
            'columns' => [
                'id' => [
                    'column' => 'id',
                    'type' => 'bigint',
                    'nullable' => false,
                    'auto_increment' => true,
                ],
                'formId' => [
                    'column' => 'form_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'formData' => [
                    'column' => 'form_data',
                    'type' => 'longtext',
                    'nullable' => true,
                ],
                'moduleId' => [
                    'column' => 'module_id',
                    'type' => 'bigint',
                    'nullable' => true,
                    'sanitizers' => ['intval'],
                ],
                'created_at' => [
                    'column' => 'created_at',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
                'updated_at' => [
                    'column' => 'updated_at',
                    'type' => 'datetime',
                    'nullable' => true,
                ],
            ],
            'timestamps' => true, // Enable automatic timestamp handling
            'soft_deletes' => false,
        ];
    }

    /**
     * Get the associated custom form
     */
    public function getForm()
    {
        return KCCustomForm::find($this->formId);
    }

    /**
     * Get form data as array
     */
    public function getFormData(): array
    {
        return json_decode($this->formData, true) ?? [];
    }

    /**
     * Set form data from array
     */
    public function setFormData(array $data): void
    {
        $this->formData = wp_json_encode($data);
    }
}
