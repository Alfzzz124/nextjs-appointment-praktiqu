<?php
/**
 * Assertions for Payments::create_order()'s `charge` path (2026-10-06 international clinic
 * design §4) and a regression check of the legacy global-rate path. Plain PHP — no PHPUnit,
 * no real WordPress or WooCommerce — runs in a bare `php:8.4-cli` container.
 *
 * The harness loads the real classes unmodified, like test-service-authenticate.php. It
 * shims only what create_order() touches, as small in-memory fakes:
 *   - WC_Order / WC_Product_Simple / WC_Order_Item_Fee / WC_Payment_Gateway / WC();
 *     FakeOrder::calculate_totals() sums the lines and adds $GLOBALS['__wc_extra_tax'],
 *     which stands in for WooCommerce applying its own tax rates;
 *   - the gateway counts process_payment() calls, so a test can prove PayPal was never
 *     contacted;
 *   - get_option() over a plain array, wp_json_encode() as json_encode().
 * It proves the plugin's own control flow (validation order, which order gets cancelled,
 * which meta is written, what is returned). It does NOT prove WooCommerce's real totals
 * maths — that stays a manual check against a WooCommerce install.
 */

declare(strict_types=1);

define('ABSPATH', __DIR__ . '/');

final class WooCommerce
{
}

final class WP_Error
{
    public function __construct(public string $code = '', public string $message = '', public mixed $data = null)
    {
    }

    public function get_error_code(): string
    {
        return $this->code;
    }

    public function get_error_message(): string
    {
        return $this->message;
    }

    public function get_error_data(): mixed
    {
        return $this->data;
    }
}

function is_wp_error($thing): bool
{
    return $thing instanceof WP_Error;
}

$GLOBALS['__praktiqu_test_options'] = [];
$GLOBALS['__wc_orders']             = [];
$GLOBALS['__wc_products']           = [];
$GLOBALS['__wc_extra_tax']          = 0.0;
$GLOBALS['__filters']               = [];

function get_option(string $name, $default = false)
{
    return array_key_exists($name, $GLOBALS['__praktiqu_test_options'])
        ? $GLOBALS['__praktiqu_test_options'][$name]
        : $default;
}

function wp_json_encode($data)
{
    return json_encode($data);
}

function esc_url_raw(string $url): string
{
    return $url;
}

function add_filter(string $hook, $callback, int $priority = 10, int $args = 1): bool
{
    $GLOBALS['__filters'][$hook] = ($GLOBALS['__filters'][$hook] ?? 0) + 1;
    return true;
}

function remove_filter(string $hook, $callback, int $priority = 10): bool
{
    $GLOBALS['__filters'][$hook] = ($GLOBALS['__filters'][$hook] ?? 0) - 1;
    return true;
}

function get_woocommerce_currency(): string
{
    return 'IDR';
}

function wc_clear_notices(): void
{
}

class WC_Order
{
    public string $currency = 'IDR';
    public string $status = 'pending';
    /** @var list<string> */
    public array $notes = [];
    /** @var list<array{0: string, 1: string}> [name, price] */
    public array $product_lines = [];
    /** @var list<array{0: string, 1: string}> [name, total] */
    public array $fee_lines = [];
    /** @var array<string, mixed> */
    public array $meta = [];
    public float $total = 0.0;
    public mixed $payment_method = null;

    public function __construct(public int $id)
    {
    }

    public function get_id(): int
    {
        return $this->id;
    }

    public function set_currency(string $currency): void
    {
        $this->currency = $currency;
    }

    public function get_currency(): string
    {
        return $this->currency;
    }

    public function add_product($product, int $qty): void
    {
        $this->product_lines[] = [$product->name, $product->price];
    }

    public function add_item($item): void
    {
        $this->fee_lines[] = [$item->name, $item->total];
    }

    public function set_billing_email(string $email): void
    {
    }

    public function update_meta_data(string $key, $value): void
    {
        $this->meta[$key] = $value;
    }

    public function get_meta(string $key)
    {
        return $this->meta[$key] ?? '';
    }

    public function calculate_totals(): void
    {
        $total = $GLOBALS['__wc_extra_tax'];
        foreach ($this->product_lines as [, $price]) {
            $total += (float) $price;
        }
        foreach ($this->fee_lines as [, $line_total]) {
            $total += (float) $line_total;
        }
        $this->total = round($total, 2);
    }

    public function save(): int
    {
        return $this->id;
    }

    public function get_total(): float
    {
        return $this->total;
    }

    public function update_status(string $status, string $note = ''): void
    {
        $this->status  = $status;
        $this->notes[] = $note;
    }

    public function payment_complete(): void
    {
        $this->status = 'processing';
    }

    public function set_payment_method($gateway): void
    {
        $this->payment_method = $gateway;
    }

    public function get_checkout_order_received_url(): string
    {
        return 'https://wp.test/order-received/' . $this->id;
    }
}

function wc_create_order(): WC_Order
{
    $order = new WC_Order(1000 + count($GLOBALS['__wc_orders']));
    $GLOBALS['__wc_orders'][] = $order;
    return $order;
}

class WC_Product_Simple
{
    public string $name = '';
    public string $price = '';

    public function set_name(string $name): void
    {
        $this->name = $name;
    }

    public function set_price(string $price): void
    {
        $this->price = $price;
    }

    public function set_status(string $s): void
    {
    }

    public function set_regular_price(string $p): void
    {
    }

    public function set_virtual(bool $v): void
    {
    }

    public function set_sold_individually(bool $v): void
    {
    }

    public function set_catalog_visibility(string $v): void
    {
    }

    public function set_manage_stock(bool $v): void
    {
    }

    public function set_stock_status(string $v): void
    {
    }

    public function save(): int
    {
        $id = 500 + count($GLOBALS['__wc_products']);
        $GLOBALS['__wc_products'][$id] = $this;
        return $id;
    }
}

function wc_get_product(int $id): WC_Product_Simple
{
    return $GLOBALS['__wc_products'][$id];
}

class WC_Order_Item_Fee
{
    public string $name = '';
    public string $total = '';

    public function set_name(string $name): void
    {
        $this->name = $name;
    }

    public function set_amount(string $amount): void
    {
    }

    public function set_total(string $total): void
    {
        $this->total = $total;
    }
}

class WC_Payment_Gateway
{
    public string $enabled = 'yes';
    public string $id = 'ppcp-gateway';
    public int $calls = 0;

    public function process_payment(int $order_id): array
    {
        $this->calls++;
        return ['result' => 'success', 'redirect' => 'https://paypal.test/checkout/' . $order_id];
    }
}

$GLOBALS['__gateway'] = new WC_Payment_Gateway();

final class FakeGateways
{
    public function payment_gateways(): array
    {
        return [$GLOBALS['__gateway']];
    }
}

final class FakeWC
{
    public function payment_gateways(): FakeGateways
    {
        return new FakeGateways();
    }
}

function WC(): FakeWC
{
    return new FakeWC();
}

require_once __DIR__ . '/../includes/class-praktiqu-endpoint-money.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-clinic-payment-settings.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-charge-validator.php';
require_once __DIR__ . '/../includes/class-praktiqu-endpoint-payments.php';

use PraktiQU\Endpoint\Payments;

$failures = 0;

function check(string $label, $actual, $expected): void
{
    global $failures;
    if ($actual === $expected) {
        echo "  ok   {$label}\n";
        return;
    }
    $failures++;
    echo "  FAIL {$label}\n";
    echo "       expected: " . var_export($expected, true) . "\n";
    echo "       actual:   " . var_export($actual, true) . "\n";
}

/**
 * Reset the fakes, then run create_order(). $clinic_option is clinic 4's raw stored value;
 * null = absent. $global_rate is the raw global rate option ('' = unset).
 */
function run(array $input, mixed $clinic_option, float $extra_tax = 0.0, string $global_rate = '18000')
{
    $GLOBALS['__wc_orders']    = [];
    $GLOBALS['__wc_products']  = [];
    $GLOBALS['__wc_extra_tax'] = $extra_tax;
    $GLOBALS['__filters']      = [];
    $GLOBALS['__gateway']->calls = 0;
    $GLOBALS['__praktiqu_test_options'] = [
        'praktiqu_endpoint_paypal_idr_rate'       => $global_rate,
        'praktiqu_endpoint_paypal_markup_percent' => '10',
    ];
    if ($clinic_option !== null) {
        $GLOBALS['__praktiqu_test_options']['praktiqu_endpoint_clinic_4_payment'] = $clinic_option;
    }
    return (new Payments())->create_order($input);
}

/** [status, code] of a WP_Error, or 'ok'. */
function error_of($result)
{
    return $result instanceof WP_Error ? [$result->get_error_data()['status'] ?? null, $result->get_error_code()] : 'ok';
}

function last_order(): ?WC_Order
{
    $orders = $GLOBALS['__wc_orders'];
    return $orders === [] ? null : $orders[count($orders) - 1];
}

/** The §2 worked example as Next.js sends it (plus a tax line). */
function input(array $override = []): array
{
    return array_merge([
        'source'        => 'public',
        'appointmentId' => '77',
        'customerEmail' => 'pasien@klinik.test',
        'method'        => 'paypal',
        'items'         => [['name' => 'Konsultasi', 'price' => 200000]],
        'taxes'         => [['name' => 'PPN', 'amount' => 20000]],
        'returnUrl'     => 'https://fe.test/kembali',
        'cancelUrl'     => 'https://fe.test/batal',
        'charge'        => [
            'currency' => 'USD',
            'items'    => [['name' => 'Konsultasi', 'amount' => '12.23']],
            'taxes'    => [['name' => 'PPN', 'amount' => '1.23']],
            'fee'      => ['name' => 'International service fee', 'amount' => '1.39'],
            'total'    => '14.85',
            'snapshot' => [
                'clinicId'      => 4,
                'fxRate'        => '18000',
                'markupPercent' => '10',
                'fixedFeeIdr'   => '25000',
                'source'        => ['fxRate' => 'clinic', 'markupPercent' => 'global', 'fixedFeeIdr' => 'clinic'],
            ],
        ],
    ], $override);
}

$international = '{"international":true,"fx_rate":18000,"markup_percent":null,"fixed_fee_idr":25000,"updated_at":"2026-10-06T08:00:00+00:00","updated_by":123}';

echo "create_order rejects a bad charge before any WooCommerce order exists\n";
check('charge with xendit -> 400 invalid_charge', error_of(run(input(['method' => 'xendit']), $international)), [400, 'invalid_charge']);
check('... and no order was created', last_order(), null);
$bad_sum = input();
$bad_sum['charge']['total'] = '14.86';
$result = run($bad_sum, $international);
check('mismatched line sum -> 400 invalid_charge', error_of($result), [400, 'invalid_charge']);
check('... with the validator message', $result instanceof WP_Error ? $result->get_error_message() : null, 'charge lines sum to 14.85 but charge.total is 14.86');
check('... and no order was created', last_order(), null);
check('charge as a string -> 400 invalid_charge', error_of(run(input(['charge' => 'USD 14.85']), $international)), [400, 'invalid_charge']);

// WordPress core skips a null param (sanitize_params / has_valid_params), so a JSON
// `"charge": null` reaches create_order() with the key present. It must not fall into the
// legacy global-rate path, which skips the clinic International gate.
echo "\ncreate_order rejects a present-but-null charge, whatever the method\n";
$result = run(input(['charge' => null]), $international);
check('charge null with paypal -> 400 invalid_charge', error_of($result), [400, 'invalid_charge']);
check('... with the plugin message', $result instanceof WP_Error ? $result->get_error_message() : null, 'charge must be an object when present');
check('... and no order was created', last_order(), null);
check('... and PayPal was never contacted', $GLOBALS['__gateway']->calls, 0);
check('charge null with paypal on a non-international clinic -> still 400, not the legacy path', error_of(run(input(['charge' => null]), null)), [400, 'invalid_charge']);
check('... and no order was created', last_order(), null);
check('charge null with xendit -> 400 invalid_charge', error_of(run(input(['method' => 'xendit', 'charge' => null]), $international)), [400, 'invalid_charge']);
check('... and no order was created', last_order(), null);

echo "\ncreate_order defence in depth: the clinic option must say international\n";
check('option missing -> 409 clinic_not_international', error_of(run(input(), null)), [409, 'clinic_not_international']);
check('... and no order was created', last_order(), null);
check('international false -> 409', error_of(run(input(), '{"international":false,"fx_rate":18000,"markup_percent":null,"fixed_fee_idr":null,"updated_at":"x","updated_by":null}')), [409, 'clinic_not_international']);
check('a serialized (array) option -> 409', error_of(run(input(), ['international' => true])), [409, 'clinic_not_international']);
check('malformed JSON -> 409', error_of(run(input(), '{"international":tru')), [409, 'clinic_not_international']);

echo "\ncreate_order builds the order from the charge lines\n";
$result = run(input(), $international);
$order  = last_order();
check('returns the order', is_array($result) ? $result['orderId'] : error_of($result), 1000);
check('checkoutUrl is the gateway redirect', $result['checkoutUrl'] ?? null, 'https://paypal.test/checkout/1000');
check('chargedAmount is the order total', $result['chargedAmount'] ?? null, 14.85);
check('chargedCurrency is USD', $result['chargedCurrency'] ?? null, 'USD');
check('fxRate is the effective snapshot rate', $result['fxRate'] ?? null, 18000.0 / (1 + 10.0 / 100));
check('order currency USD', $order?->currency, 'USD');
check('item line from cents', $order?->product_lines, [['Konsultasi', '12.23']]);
check('tax line and fee line from cents', $order?->fee_lines, [['PPN', '1.23'], ['International service fee', '1.39']]);
check('meta praktiqu_clinic_id', $order?->meta['praktiqu_clinic_id'] ?? null, '4');
check('meta praktiqu_fixed_fee_idr', $order?->meta['praktiqu_fixed_fee_idr'] ?? null, '25000');
check('meta praktiqu_fx_source', $order?->meta['praktiqu_fx_source'] ?? null, '{"fxRate":"clinic","markupPercent":"global","fixedFeeIdr":"clinic"}');
check('meta praktiqu_fx_rate from the snapshot', $order?->meta['praktiqu_fx_rate'] ?? null, '18000');
check('meta praktiqu_markup_percent from the snapshot', $order?->meta['praktiqu_markup_percent'] ?? null, '10');
check('meta praktiqu_charge_currency', $order?->meta['praktiqu_charge_currency'] ?? null, 'USD');
check('meta praktiqu_expected_idr still from the rupiah lines', $order?->meta['praktiqu_expected_idr'] ?? null, '220000');
check('meta praktiqu_method', $order?->meta['praktiqu_method'] ?? null, 'paypal');
check('the gateway was called once', $GLOBALS['__gateway']->calls, 1);
check('the 2-decimal filter was removed again', $GLOBALS['__filters']['wc_get_price_decimals'] ?? null, 0);

$no_global = run(input(), $international, 0.0, '');
check('the charge path does not need the global rate', is_array($no_global) ? 'ok' : error_of($no_global), 'ok');

echo "\ncreate_order cancels on a total mismatch, before any gateway call\n";
$result = run(input(), $international, 0.50);
$order  = last_order();
check('WooCommerce added 0.50 of its own tax -> 502 charge_mismatch', error_of($result), [502, 'charge_mismatch']);
check('the order is cancelled', $order?->status, 'cancelled');
check('with a PraktiQU note', $order?->notes, ['PraktiQU: charge_mismatch, WooCommerce total 15.35 USD but charge.total 14.85 USD']);
check('PayPal is never contacted', $GLOBALS['__gateway']->calls, 0);

echo "\ncreate_order without charge keeps the legacy global-rate path\n";
$legacy = input();
unset($legacy['charge']);
$result = run($legacy, null);
$order  = last_order();
check('legacy paypal order succeeds without a clinic option', is_array($result) ? 'ok' : error_of($result), 'ok');
check('legacy item converted with Money (rate 18000, markup 10)', $order?->product_lines, [['Konsultasi', '12.23']]);
check('legacy tax converted with Money', $order?->fee_lines, [['PPN', '1.23']]);
check('legacy writes no clinic meta', array_key_exists('praktiqu_clinic_id', $order?->meta ?? []), false);
$xendit = input(['method' => 'xendit']);
unset($xendit['charge']);
$GLOBALS['__gateway']->id = 'xendit_invoice';
$result = run($xendit, null);
check('xendit without charge still works in IDR', [is_array($result) ? $result['chargedCurrency'] : error_of($result), last_order()?->product_lines], ['IDR', [['Konsultasi', '200000']]]);
$GLOBALS['__gateway']->id = 'ppcp-gateway';

echo "\n";
if ($failures > 0) {
    echo "{$failures} FAILURE(S)\n";
    exit(1);
}
echo "ALL PASS\n";
