<?php
if (!defined('ABSPATH')) {
  exit;
}

$bill            = $bill ?? [];
$patient         = $patient ?? [];
$doctor          = $doctor ?? [];
$clinic          = $clinic ?? [];
$service_items   = $service_items ?? [];
$tax_items       = $tax_items ?? [];
$currency_detail = $currency_detail ?? ['prefix' => '$', 'postfix' => ''];
$clinic_logo       = $clinic_logo ?? ['id' => '', 'url' => ''];
$payment_method  = $payment_method ?? 'N/A';

function money($amount, $currency)
{
  return ($currency['prefix'] ?? '') . number_format((float)$amount, 2) . ($currency['postfix'] ?? '');
}

function calc_age($dob)
{
  if (!$dob) return 'N/A';
  try {
    return date_diff(date_create($dob), date_create('today'))->y . ' Years';
  } catch (Exception $e) {
    return 'N/A';
  }
}
?>
<!DOCTYPE html>
<html>

<head>
  <meta charset="UTF-8">
  <title><?php echo esc_html(__('Invoice', 'kivicare-pro')); ?></title>

  <style>
    /* fix: Removed float-based layout (unsupported in mPDF). All column layouts now use table-based approach. */
    /* fix: Removed box-sizing:border-box and word-break:break-word (unsupported in mPDF). */

    body {
      font-family: DejaVu Sans, sans-serif;
      font-size: 11px;
      color: #000;
    }

    /* fix: Replaced float-based .col-6 / .col-3 with table layout for mPDF compatibility */
    .header-table {
      width: 100%;
      border-collapse: collapse;
    }

    .header-divider {
      border-bottom: 1px solid #ddd;
      margin-bottom: 20px;
      padding-bottom: 12px;
    }

    .logo {
      height: 40px;
    }

    .title {
      font-size: 13px;
      font-weight: bold;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th {
      background: #f5f6fa;
      font-weight: bold;
      padding: 8px;
      border-bottom: 1px solid #ddd;
      text-align: left;
    }

    td {
      padding: 8px;
      border-bottom: 1px solid #eee;
    }

    .services th {
      border-bottom: 2px solid #2d3748;
      /* fix: background must be set inline or via simpleTables=false for mPDF to honour it */
      background: #f5f6fa;
    }

    .right-align {
      text-align: right;
    }

    .summary td {
      padding: 6px;
      font-size: 12px;
    }

    .summary .label {
      text-align: right;
      font-weight: bold;
    }

    .summary .value {
      text-align: right;
    }

    .grand td {
      border-top: 2px solid #2d3748;
      font-weight: bold;
    }

    .footer {
      margin-top: 30px;
      font-size: 12px;
    }

    .paid {
      color: green;
      font-weight: bold;
    }
  </style>
</head>

<body>

  <!-- fix: Replaced float-based .row/.col-6/.col-3 div layout with HTML table layout for mPDF multi-column support -->
  <div class="header-divider">
    <table class="header-table">
      <tr>
        <td style="width:50%; vertical-align:middle;">
          <?php if (!empty($clinic_logo['url'])): ?>
            <img src="<?php echo esc_url($clinic_logo['url']); ?>" class="logo">
          <?php endif; ?>
        </td>
        <td style="width:25%; text-align:right; vertical-align:top;">
          <strong><?php echo esc_html(__('Invoice Date:', 'kivicare-pro')); ?></strong>
          <?php echo !empty($bill['date']) ? esc_html($bill['date']) : 'N/A'; ?><br>
        </td>
        <td style="width:25%; text-align:right; vertical-align:top;">
          <strong><?php echo esc_html(__('Invoice No:', 'kivicare-pro')); ?></strong>
          #<?php echo esc_html($bill['invoice_id'] ?? $bill['id'] ?? 'N/A'); ?><br>
        </td>
      </tr>
    </table>

    <table class="header-table" style="margin-top:10px;">
      <tr>
        <td style="width:50%; vertical-align:top;">
          <div class="title"><?php echo esc_html($doctor['name'] ?? ''); ?></div>
          <div><strong><?php echo esc_html(__('Address:', 'kivicare-pro')); ?></strong> <?php
            $address_parts = array_filter([
              $clinic['address'] ?? '',
              $clinic['city'] ?? '',
              $clinic['postal_code'] ?? '',
              $clinic['country'] ?? ''
            ]);
            echo esc_html(implode(', ', $address_parts));
          ?></div>
        </td>
        <td style="width:50%; text-align:right; vertical-align:top;">
          <div><strong><?php echo esc_html(__('Contact:', 'kivicare-pro')); ?></strong> <?php echo esc_html($clinic['phone'] ?? ''); ?></div>
          <div><strong><?php echo esc_html(__('Email:', 'kivicare-pro')); ?></strong> <?php echo esc_html($clinic['email'] ?? ''); ?></div>
        </td>
      </tr>
    </table>
  </div>

  <div class="title" style="margin-top:20px;"><?php echo esc_html(__('Patient Information', 'kivicare-pro')); ?></div>
  <table style="margin-top:10px;">
    <thead>
      <tr>
        <th><?php echo esc_html(__('Patient ID', 'kivicare-pro')); ?></th>
        <th><?php echo esc_html(__('Patient Name', 'kivicare-pro')); ?></th>
        <th><?php echo esc_html(__('Age', 'kivicare-pro')); ?></th>
        <th><?php echo esc_html(__('Contact', 'kivicare-pro')); ?></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><?php echo esc_html($patient['id'] ?? 'N/A'); ?></td>
        <td><?php echo esc_html($patient['name'] ?? 'N/A'); ?></td>
        <td><?php echo esc_html(calc_age($patient['dob'] ?? null)); ?></td>
        <td><?php echo esc_html($patient['phone'] ?? 'N/A'); ?></td>
      </tr>
    </tbody>
  </table>

  <div class="title" style="margin-top:20px;"><?php echo esc_html(__('Service Details', 'kivicare-pro')); ?></div>
  <table class="services" style="margin-top:10px;">
    <thead>
      <tr>
        <th width="10%"><?php echo esc_html(__('S No.', 'kivicare-pro')); ?></th>
        <th width="50%"><?php echo esc_html(__('Description', 'kivicare-pro')); ?></th>
        <th width="20%" class="right-align"><?php echo esc_html(__('Price', 'kivicare-pro')); ?></th>
        <th width="20%" class="right-align"><?php echo esc_html(__('Amount', 'kivicare-pro')); ?></th>
      </tr>
    </thead>
    <tbody>
      <?php
      $sub_total = 0;
      if (!empty($service_items)):
        foreach ($service_items as $i => $item):
          $amount = (float)($item['total'] ?? 0);
          $sub_total += $amount;
      ?>
          <tr>
            <td><?php echo $i + 1; ?></td>
            <td><?php echo esc_html($item['name'] ?? 'Service'); ?></td>
            <td class="right-align"><?php echo money($item['price'] ?? 0, $currency_detail); ?></td>
            <td class="right-align"><?php echo money($amount, $currency_detail); ?></td>
          </tr>
        <?php endforeach;
      else: ?>
        <tr>
          <td colspan="4" style="text-align:center;"><?php echo esc_html(__('No services', 'kivicare-pro')); ?></td>
        </tr>
      <?php endif; ?>
    </tbody>
  </table>

  <?php if (!empty($tax_items)): ?>
  <div class="title" style="margin-top:20px;"><?php echo esc_html(__('Tax Details', 'kivicare-pro')); ?></div>
  <table class="services" style="margin-top:10px;">
    <thead>
      <tr>
        <th width="10%"><?php echo esc_html(__('S No.', 'kivicare-pro')); ?></th>
        <th width="70%"><?php echo esc_html(__('Tax Name', 'kivicare-pro')); ?></th>
        <th width="20%" class="right-align"><?php echo esc_html(__('Charges', 'kivicare-pro')); ?></th>
      </tr>
    </thead>
    <tbody>
      <?php
        foreach ($tax_items as $i => $tax):
      ?>
          <tr>
            <td><?php echo $i + 1; ?></td>
            <td><?php echo esc_html($tax['name'] ?? 'Tax'); ?></td>
            <td class="right-align"><?php echo money($tax['charges'] ?? 0, $currency_detail); ?></td>
          </tr>
        <?php endforeach; ?>
    </tbody>
  </table>
  <?php endif; ?>

  <?php
  $tax_total = 0;
  foreach ($tax_items as $tax) {
    $tax_total += (float)($tax['charges'] ?? 0);
  }
  $grand_total = $bill['actual_amount'] ?? ($sub_total + $tax_total);
  ?>

  <table class="summary" style="margin-top:15px;">
    <tr>
      <td width="60%"></td>
      <td width="20%" class="label"><?php echo esc_html(__('Sub Total:', 'kivicare-pro')); ?></td>
      <td width="20%" class="value"><?php echo money($sub_total, $currency_detail); ?></td>
    </tr>
    <?php if (!empty($bill['discount']) && $bill['discount'] > 0): ?>
    <tr>
      <td></td>
      <td class="label"><?php echo esc_html(__('Discount:', 'kivicare-pro')); ?></td>
      <td class="value"><?php echo money($bill['discount'] ?? 0, $currency_detail); ?></td>
    </tr>
    <?php endif; ?>
    <tr>
      <td></td>
      <td class="label"><?php echo esc_html(__('Total Tax:', 'kivicare-pro')); ?></td>
      <td class="value"><?php echo money($tax_total, $currency_detail); ?></td>
    </tr>
    <tr class="grand">
      <td></td>
      <td class="label"><?php echo esc_html(__('Grand Total:', 'kivicare-pro')); ?></td>
      <td class="value"><?php echo money($grand_total, $currency_detail); ?></td>
    </tr>
  </table>

  <!-- fix: Replaced float-based .footer .row layout with HTML table for mPDF compatibility -->
  <div class="footer">
    <table style="width:100%;">
      <tr>
        <td style="width:50%;">
          <strong><?php echo esc_html(__('Payment Method:', 'kivicare-pro')); ?></strong> <?php echo esc_html($payment_method); ?>
        </td>
        <td style="width:50%; text-align:right;">
          <strong><?php echo esc_html(__('Payment Status:', 'kivicare-pro')); ?></strong>
          <span class="paid"><?php echo esc_html(ucfirst($bill['status'] ?? 'pending')); ?></span>
        </td>
      </tr>
    </table>
  </div>

</body>

</html>