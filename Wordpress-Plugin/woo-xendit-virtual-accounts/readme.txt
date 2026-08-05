=== Woocommerce – Xendit ===
Contributors: tpixendit
Donate link: #
Tags: xendit, woocommerce, payment gateway, payment, southeast asia
Requires at least: 4.9.16
Tested up to: 6.8
Stable tag: 5.1.9
License: GPLv2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html

Xendit Payment Gateway for WooCommerce

== Description ==

Please see our [Documentation](https://docs.xendit.co/integrations/woocommerce) for full details.

WooCommerce and WordPress enable you to build a fully fledged eCommerce platform. They are hosted and run entirely by merchants in their environment of choice.
To enrich the eCommerce experience, Xendit-WooCommerce plugin allows secure online payment on your WooCommerce store. This enables you to accept various payments via Xendit with just a few clicks.

* 2,000+ installations
* IDR/PHP/USD/VND/THB/MYR acceptance
* Accept all the most popular payment methods on your WooCommerce Store
* Supports subscriptions via credit cards with WooCommerce Subscriptions plugin
* SMS, WhatsApp and email customer notifications
* 3DS Credit Card verification
* XenPlatform Support
* Flexible payment page redirection after checkout

## Installation Overview
1. Please view our [documentation](https://docs.xendit.co/integrations/woocommerce) for full installation instructions
2. Download our [plugin](https://wordpress.org/plugins/woo-xendit-virtual-accounts) from the WordPress plug-in store
3. Connect to Xendit, and activate your desired payment channels
4. Start selling!

## Requirements
* WordPress: 4.9.16 or above
* WooCommerce: 3.3.3 or above
* PHP 7.0 or above
* Enable CUrl with OpenSSL by your web hosting provider
* Remove IP Whitelisting from you WooCommerce dashboard

== Installation ==

1. Make sure you have [WooCommerce](https://wordpress.org/plugins/woocommerce/) installed.
2. Search and install "Woocommerce – Xendit" on WordPress plugin store.
3. Activate the plugin through the 'Plugins' menu in WordPress.
4. Navigate to WooCommerce -> Settings -> Payments (tab) in your WordPress dashboard.
5. Enable `Xendit – Payment Gateway` & click Manage.
5. Fill out all the required details including your Public & Secret API Key which can be found in your Xendit dashboard (https://dashboard.xendit.co/settings/developers#api-keys). You can toggle between Test or Live Environment, then save your changes.
6. Navigate back to the Payments (tab) page & toggle all the Xendit Payment Gateways that you want to enable.
7. You may also manually change each Payment Gateway's name & description (by clicking the Manage button) that will appear in your checkout page.
8. Adjust your settings and save. You can see the new payment options by viewing your WooCommerce checkout page while you have items in the cart.

== Changelog ==
= 5.1.9 =
- New Feature: Added supported currency for SGD

= 5.1.8 =
- New Feature: Added support for Sequential Order Number Plugin.
- Users can now sync between order number set in plugin Sequential Order Number for WooCommerce.
- Tested until wordpress 6.8 and woocommerce 9.8

= 5.1.7 =
- New Feature: Added support for a new payment method accepting THB (Thai Baht).
- Users can now make payments in THB through supported gateways, including local banks through direct debit, QR code payments and Ewallets.
- Improvement: Enhanced payment method selection handling for THB currencies, making it easier to switch between local and international payment options.

= 5.1.6 =
- Bug fix: success redirect url not returning a full path in woocommerce 9.4.3

= 5.1.5 =
- Remove UangMe as a payment option

= 5.1.4 =
- New Feature: Added support for a new payment method accepting MYR (Malaysian Ringgit).
- Users can now make payments in MYR through supported gateways.
- Improvement: Enhanced payment method selection handling for MYR currencies.
- Bug fix: Fix blocking security patch from 5.1.3 version

= 5.1.3 =
- Security patch on webhook url for invoice and credit-card payment method

= 5.1.2 =
- Fix incorrect maximum checkout amount for QRIS (ID) channel

= 5.1.1 =
- Change filename on plugin info

= 5.1.0 =
- Fix adding metadata when when processing a checkout
- Compatibility tested with wordpress v6.6

= 5.0.9 =
- Remove unrelevant folder in deployment

= 5.0.8 =
- New: Added support for QRPh payment method

= 5.0.7 =
- Fix missing item in Deposit plugin

= 5.0.6 =
- Improve webhook process

= 5.0.5 =
- Fix incompatible with JetBooking

= 5.0.4 =
- Fix set default token on my-account

= 5.0.3 =
- Fix set default token on next recurring payment

= 5.0.2 =
- Fix filter token

= 5.0.1 =
- Fix delete user

= 5.0.0 =
- Support Woocommerce Blocks

= 4.0.3 =
- Fix zero charge for subscriptions

= 4.0.2 =
- Fix default subscription payment

= 4.0.1 =
- Fix subscription renewal

= 4.0.0 =
- Split woocommerce onboarding

= 3.11.0 =
- Validate XenPlatform user settings
- Fix Credit card webhook

= 3.10.1 =
- Fix function incompatible with PHP8

= 3.10.0 =
- Add CIMB Payment Channel (IDR)
- Add Chinabank Payment Channel (PHP)
- Improve QRIS redirect

= 3.9.1 =
- Fix the setting when onboarding Xendit PG

= 3.9.0 =
- Auto cancel pending orders deprecated
- Add Credit card icon settings
- Auto enable the activated Xendit payment channels
- Fix enable/disable Xendit gateway
- Tested up to WP v6.3

= 3.8.0 =
- Support new currencies (VND, THB and MYR)

= 3.7.6 =
- Fix order success page error

= 3.7.5 =
- Fix discount item

= 3.7.4 =
- Update new ShopeePay icon

= 3.7.3 =
- Update Akulaku min/max total

= 3.7.2 =
- Improve Xendit integration via OAuth

= 3.7.1 =
- Fix invoice item price for Amelia

= 3.7.0 =
- Add BSS payment method
- Improve error message

= 3.6.1 =
- Improve Xendit metrics

= 3.6.0 =
- Improve connection with Xendit
- Deprecate the manual refund via bank

= 3.5.1 =
- Fix the function compatible with PHP 8.x

= 3.5.0 =
- Improve QRIS redirection
- Improve invoice fee
- Expire Xendit invoice when the order canceled

= 3.4.0 =
- Add default order status
- Add Atome Paylater payment method

= 3.3.0 =
- Add LBC Retail payment method
- Improve payment icons

= 3.2.0 =
- Add new payment ECPay School

= 3.1.2 =
- Clear cart session when user place order

= 3.1.1 =
- Fix CC

= 3.1.0 =
- Support all currencies

= 3.0.2 =
- Remove customer object

= 3.0.1 =
- Fix JS conflicted

= 3.0.0 =
- Change visa and paymaya logo
- Reduce minimum amount transction with QR
- Add new PHP payment: Direct Debit RCBC
- Support EN and ID language
- Improve connect experience

= 2.41.0 =
- Add new IDR payment: Akulaku
- Improve customer object

= 2.40.1 =
- Increase e-wallet limit(Dana, OVO and ShopeePay) to 20M

= 2.40.0 =
- Add new IDR payment: AstraPay

= 2.39.3 =
- Fix the default amount used to create authentication for CC token

= 2.39.2 =
- Add default dot in api key

= 2.39.1 =
- Fix the stuck when update payment method

= 2.39.0 =
- Improve connect button
- Improve API Key fileds
- Add expired time for XenPlatform

= 2.38.0 =
- Implement Xendit invoice for subscription
- Support changing payment method for subscription

= 2.37.5 =
- Show all payment channels in admin settings

= 2.37.4 =
- Update readme

= 2.37.3 =
- Coder refactoring

= 2.37.2 =
- Tested up to WordPress v6.0

= 2.37.1 =
- Fix mobile number default value

= 2.37.0 =
- Add new payment Uangme in IDR

= 2.36.0 =
- Add disconnect button

= 2.35.0 =
- Add new payment ShopeePay in PH

= 2.34.2 =
- Handle error

= 2.34.1 =
- Fix external ID format

= 2.34.0 =
- Add new payment Cashalo

= 2.33.2 =
- Fix the magic function

= 2.33.1 =
- Fix the function name

= 2.33.0 =
- Add new payment Mlhuillier
- Add new payment Palawan
- Add new payment ECPay Loan

= 2.32.1 =
- Fix Credit card token for product subscription variable

= 2.32.0 =
- Update payment channel icons

= 2.31.2 =
- Fix Credit card subscription token

= 2.31.1 =
- Improve settings page

= 2.31.0 =
- Improve OAuth
- Add BJB VA Payment method

= 2.30.2 =
- CC description bug fix

= 2.30.1 =
- Miscellaneous bug fixes (CC by invoice)

= 2.30.0 =
- Add Cebuana Payment Channel

= 2.29.2 =
- Give default category name in invoice payload

= 2.29.1 =
- Add default last name & category in invoice payload

= 2.29.0 =
- Add BillEase Payment Channel
- Move Kredivo to XenInvoice
- Migrate card flow using Xeninvoice

= 2.28.0 =
- Add BSI VA payment method
- Set payer email to be optional

= 2.27.6 =
- Change province state attribute in customer object

= 2.27.5 =
- Remove Bank Transfer - BNI Syariah payment method (no longer supported)

= 2.27.4 =
- Remove email settings form in admin panel
- Remove expiry invoice duration form in admin panel
- New customer object to send notification inside invoice payload

= 2.27.3 =
- incorrect unit price for item

= 2.27.2 =
- Adjust min and max amount for each payment

= 2.27.1 =
- Allow both API Keys & OAuth

= 2.27.0 =
- Integrate OAuth & remove secret key authentication
- Remove custom email template

= 2.26.0 =
- Move LinkAja payment method into Xendit Invoice
- Move QRIS payment method into Xendit Invoice
- Removing DANA from ewallet and adding in to invoice flow
- Removing OVO from ewallet and adding in to invoice flow

= 2.25.1 =
- Change display for card promotion discount on admin order page
- Enable MID settings check to display supported CC brands
- Tidy up payment logo

= 2.25.0 =
- Add Direct Debit UBP payment method for PHP currencies

= 2.24.1 =
- Increase QRIS limit to 5 million IDR

= 2.24.0 =
- Add GCash payment method for PHP currencies
- Add GrabPay payment method for PHP currencies

= 2.23.1 =
- Miscellaneous bug fixes

= 2.23.0 =
- Add BNI Syariah Payment method

= 2.22.0 =
- Enable credit card promotions during checkout - automatically applied
- Fix default status

= 2.21.0 =
- Add Card payment method for USD currencies
- Remove invoice settings
- Fix bug when sending reference id in getCustomerByReferenceId

= 2.20.0 =
- Add 7-Eleven payment method for PHP currencies
- Cleanup log

= 2.19.0 =
- Add PayMaya payment method for PHP currencies

= 2.18.4 =
- Bug fixes for Wordpress 5.7+
- Add Kredivo SOP in admin setting

= 2.18.3 =
- Update credit card logo for PH region

= 2.18.2 =
- Fix time out issue

= 2.18.1 =
- Fix CC JS for expiry date issue

= 2.18.0 =
- Customer object implementation

= 2.17.0 =
- Error message standardization
- Move Direct Debit to XenInvoice

= 2.16.2 =
- Bug fixes on getting invoice settings

= 2.16.1 =
- Improve API Key security on gateway settings
- Direct Debit bug fixes

= 2.16.0 =
- Add Shopeepay payment method

= 2.15.0 =
- Add metrics

= 2.14.0 =
- Support installment on credit card

= 2.13.0 =
- Add send environment information for debugging

= 2.12.0 =
* Add BPI payment method
* Callback changes

= 2.11.5 =
* Synchronize invoice payment method in order detail
* Reformat order notes

= 2.11.4 =
* Fix error not displayed on certain theme

= 2.11.3 =
* Miscellaneous bug fixes
* Update Email Notifications

= 2.11.2 =
* Fix error message when save settings

= 2.11.1 =
* Fix QRIS callback

= 2.11.0 =
* Add QRIS payment method

= 2.10.1 =
* Subscription bugfix

= 2.10.0 =
* New XenPlatform OnBehalfOf option

= 2.9.2 =
* Bugfix for unchanged payment status
* General housekeeping

= 2.9.1 =
* Add PHP currency for credit card payment method

= 2.9.0 =
* Add BRI direct debit
* Add saved card features

= 2.8.1 =
* Minor bug fixes on error handling

= 2.8.0 =
* Add indomaret payment method
* Move invoice creation hook
* Update outdated external links

= 2.7.2 =
* Fix CC order status update

= 2.7.1 =
* Fix redirect load
* Fix subscription timeout issue
* Fix form name

= 2.7.0 =
* add LINKAJA payment method
* Reconfigure Dynamic 3DS

= 2.6.1 =
* Improving experience of cards status update
* Improve item information handle

= 2.6.0 =
* add DANA payment method
* Fix bug

= 2.5.0 =
* Add new settings to determine invoice flow
* Handle redirect through order received page

= 2.4.2 =
* Change CC status update flow
* Refine card validation message in checkout page

= 2.4.1 =
* Check WC order status before processing callback

= 2.4.0 =
* Change OVO flow to reduce timeout case

= 2.3.2 =
* Add x-api-version header for OVO payment

= 2.3.1 =
* Fix external id format to follow API guidelines

= 2.3.0 =
* Change flow credit card charge

= 2.2.4 =
* Add more logs in the main checkout and callback process

= 2.2.3 =
* should_authenticate is more important than should_3ds

= 2.2.2 =
* Fix escape characters

= 2.2.1 =
* Miscellaneous bug fixes

= 2.2.0 =
* New cardless credit payment method - Kredivo

= 2.1.0 =
* Add dynamic 3DS feature
* Enhance subscription feature to make it usable for all merchant

= 2.0.0 =
* Merged credit card payment method - 1 plugin for all.

= 1.8.2 =
* Enhancement: Bypass minimum amount for OVO on development mode

= 1.8.1 =
* Enhancement: Use callback endpoint for ewallet completion process to make it more reliable

= 1.8.0 =
* New feature: Enable merchant to change payment description in checkout page

= 1.7.2 =
* Fix order cancellation that affect orders that are created not using xendit

= 1.7.1 =
* Remove individual enable checkmark on each payment method

= 1.7.0 =
* New feature: Enable merchant to change payment method name

= 1.6.1 =
* Bugfix faulty notification URL for new external id

= 1.6.0 =
* Add custom external id form
* Rearrange Xendit setting page

= 1.5.1 =
* Fix failed publish

= 1.5.0 =
* Add refund function

= 1.4.2 =
* Add custom expiry time in admin options

= 1.4.1 =
* Fix faulty amount validation

= 1.4.0 =
* Remove callback URL interface

= 1.3.0 =
* Add OVO payment method

= 1.2.6 =
* Add alert when changing API key

= 1.2.5 =
* Fix wrong enum names

= 1.2.3 =
* Improve logging

= 1.2.2 =
* Fix issue where notification is not processed correctly

= 1.2.1 =
* Fix callback issue

= 1.2.0 =
* Change creds field to password
* Add alfamart payment method

= 1.1.1 =
* Minor bugfix for API request

= 1.1.0 =
* Split VA payment method to individual bank
* No longer display account number info in checkout/order received page
* Now use redirect scheme with Xendit invoice UI

= 1.0.5 =
* Fix minor visual bug on Xendit icon

= 1.0.4 =
* Change plugin description

= 1.0.3 =
* Improve stability
* Add measurement

= 1.0.2 =
* Fixed amount calculation for checkout page

= 1.0.1 =
* Automatic order cancellation for expired Xendit invoice.
* Fixed bank order display

= 1.0 =
* Initial version.

== Upgrade Notice ==

= 1.0 =
Initial version.
