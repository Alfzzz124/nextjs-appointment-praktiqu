<?php

namespace KCProApp\database\Migrations;

use App\database\classes\KCAbstractMigration;
use App\emails\KCEmailTemplateManager;
use KCProApp\notifications\KCPNotificationTemplateManager;

defined('ABSPATH') or die('Something went wrong');

/**
 * Migration to add the default Follow-up Reminder Email and Push notification templates.
 */
class AddFollowupEmailAndPushTemplates extends KCAbstractMigration
{
    public function run()
    {
        KCEmailTemplateManager::getInstance()->createDefaultTemplates('mail');
        KCPNotificationTemplateManager::getInstance()->createDefaultTemplates();
    }
}
