<?php

namespace KCProApp\database\Migrations;

use App\database\classes\KCAbstractMigration;
use KCProApp\notifications\KCPNotificationTemplateManager;

defined('ABSPATH') or die('Something went wrong');

class AddDefaultSMSWhatsappTemplate extends KCAbstractMigration
{

    public function run()
    {
        KCPNotificationTemplateManager::getInstance()->createDefaultTemplates();
    }
}
