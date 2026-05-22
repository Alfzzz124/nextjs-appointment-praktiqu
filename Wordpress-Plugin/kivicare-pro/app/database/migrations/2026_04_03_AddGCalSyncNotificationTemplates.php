<?php

namespace KCProApp\database\Migrations;

use App\database\classes\KCAbstractMigration;
use App\emails\KCEmailTemplateManager;
use KCProApp\notifications\KCPNotificationTemplateManager;

defined('ABSPATH') or die('Something went wrong');

/**
 * Migration to add the default Google Calendar Sync Email and Push notification templates.
 */
class AddGCalSyncNotificationTemplates extends KCAbstractMigration
{
    public function run()
    {
        // Create Email templates (Lite Manager)
        KCEmailTemplateManager::getInstance()->createDefaultTemplates('mail');
        
        // Create Notification/SMS templates (Pro Manager)
        KCPNotificationTemplateManager::getInstance()->createDefaultTemplates();
    }
}
