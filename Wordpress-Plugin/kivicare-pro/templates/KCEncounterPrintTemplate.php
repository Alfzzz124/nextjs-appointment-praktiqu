<!DOCTYPE html>
<html>

<head>
  <meta charset="UTF-8">
  <title><?php echo esc_html(__('Encounter Details', 'kivicare-pro')); ?></title>

  <style>
    body {
      font-family: DejaVu Sans, sans-serif;
      font-size: 12px;
      color: #333;
      margin: 18pt;
    }

    .page {
      width: 100%;
    }

    /* HEADER */
    .header-table {
      width: 100%;
      border-collapse: collapse;
    }

    .header-left {
      width: 60%;
      vertical-align: top;
    }

    .header-right {
      width: 40%;
      text-align: right;
      vertical-align: top;
      font-size: 11px;
    }

    .logo {
      max-height: 40px;
      margin-bottom: 10px;
    }

    .doctor-name {
      font-size: 15px;
      font-weight: bold;
    }

    .doctor-spec {
      font-size: 11px;
      color: #666;
      margin-bottom: 10px;
    }

    .divider {
      border-bottom: 1px solid #ddd;
      margin: 15px 0;
    }

    /* INFO TABLE */
    .info-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    .info-table td {
      padding: 4px 0;
    }

    .label {
      font-weight: bold;
      color: #555;
    }

    /* SECTION */
    .section-title {
      font-size: 13px;
      font-weight: bold;
      margin: 20px 0 8px;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    .data-table th {
      text-align: left;
      padding: 8px;
      background: #f5f5f5;
      border-bottom: 1px solid #ccc;
    }

    .data-table td {
      padding: 8px;
      border-bottom: 1px solid #e1e1e1;
    }

    /* SIGNATURE */
    .signature {
      margin-top: 60px;
    }

    .signature-line {
      width: 180px;
      border-bottom: 1px solid #333;
      margin-bottom: 5px;
    }

    .page-title {
      text-align: center;
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 20px;
    }

    .clinic-name {
      font-size: 14px;
      font-weight: bold;
      margin-top: 5px;
    }
  </style>
</head>

<body>
  <div class="page">

    <!-- ================= PAGE TITLE ================= -->
    <div class="page-title"><?php echo esc_html(__('Encounter Details', 'kivicare-pro')); ?></div>

    <!-- ================= HEADER ================= -->
    <table class="header-table">
      <tr>
        <td class="header-left">
          <?php if (!empty($clinic_logo['url'])): ?>
            <img src="<?php echo esc_url($clinic_logo['url']); ?>" class="logo">
          <?php else: ?>
            <div class="clinic-avatar"></div>
          <?php endif; ?>
          <div class="clinic-name"><?php echo esc_html($clinic['name']); ?></div>

          <div class="doctor-name"><?php echo esc_html($doctor['name'] ?? ''); ?></div>
          <div class="doctor-spec"><?php echo esc_html($doctor['specialization'] ?? ''); ?></div>

          <table class="info-table" style="margin-top: 10px;">
            <tr>
              <td class="label"><?php echo esc_html(__('Patient Name:', 'kivicare-pro')); ?></td>
              <td><?php echo esc_html($patient['name']); ?></td>
            </tr>
            <tr>
              <td class="label"><?php echo esc_html(__('Email:', 'kivicare-pro')); ?></td>
              <td><?php echo esc_html($patient['email']); ?></td>
            </tr>
            <tr>
              <td class="label"><?php echo esc_html(__('Address:', 'kivicare-pro')); ?></td>
              <td> <?php
                    $address_parts = array_filter([
                      $patient['address'] ?? '',
                      $patient['city'] ?? '',
                      $patient['postal_code'] ?? '',
                      $patient['country'] ?? ''
                    ]);
                    echo esc_html(implode(', ', $address_parts));
                    ?>
              </td>
            </tr>
            <tr>
              <td class="label"><?php echo esc_html(__('Encounter Date & Time:', 'kivicare-pro')); ?></td>
              <td><?php echo wp_date('d/m/Y, h:i A', strtotime($encounter['created_at'])); ?></td>
            </tr>
          </table>
        </td>

        <td class="header-right">
          <strong><?php echo esc_html(__('Contact:', 'kivicare-pro')); ?></strong> <?php echo esc_html($clinic['phone']); ?><br><br>
          <strong><?php echo esc_html(__('Email:', 'kivicare-pro')); ?></strong> <?php echo esc_html($clinic['email']); ?><br><br>
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
      </tr>
    </table>

    <div class="divider"></div>

    <!-- ================= CLINICAL DETAILS ================= -->
    <?php if (!empty($medical_history)): ?>
      <div class="section-title"><?php echo esc_html(__('Clinical Details:', 'kivicare-pro')); ?></div>

      <table class="data-table">
        <thead>
          <tr>
            <th><?php echo esc_html(__('Problems', 'kivicare-pro')); ?></th>
            <th><?php echo esc_html(__('Observations', 'kivicare-pro')); ?></th>
            <th><?php echo esc_html(__('Notes', 'kivicare-pro')); ?></th>
          </tr>
        </thead>
        <tbody>
          <?php
          $rows = max(
            count($medical_history['problem'] ?? []),
            count($medical_history['observation'] ?? []),
            count($medical_history['note'] ?? [])
          );

          for ($i = 0; $i < $rows; $i++):
          ?>
            <tr>
              <td><?php echo esc_html($medical_history['problem'][$i]['title'] ?? '-'); ?></td>
              <td><?php echo esc_html($medical_history['observation'][$i]['title'] ?? '-'); ?></td>
              <td><?php echo esc_html($medical_history['note'][$i]['title'] ?? '-'); ?></td>
            </tr>
          <?php endfor; ?>
        </tbody>
      </table>
    <?php endif; ?>

    <!-- ================= PRESCRIPTION ================= -->
    <?php if (!empty($prescriptions)): ?>
      <div class="section-title"><?php echo esc_html(__('Prescription:', 'kivicare-pro')); ?></div>

      <table class="data-table">
        <thead>
          <tr>
            <th><?php echo esc_html(__('Name', 'kivicare-pro')); ?></th>
            <th><?php echo esc_html(__('Frequency', 'kivicare-pro')); ?></th>
            <th><?php echo esc_html(__('Duration', 'kivicare-pro')); ?></th>
            <th><?php echo esc_html(__('Instructions', 'kivicare-pro')); ?></th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($prescriptions as $prescription): ?>
            <tr>
              <td><?php echo esc_html($prescription['name'] ?? '-'); ?></td>
              <td><?php echo esc_html($prescription['frequency'] ?? '-'); ?></td>
              <td><?php echo esc_html($prescription['duration'] ?? '-'); ?></td>
              <td><?php echo esc_html($prescription['instruction'] ?? '-'); ?></td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    <?php endif; ?>

    <!-- ================= CUSTOM FIELDS ================= -->
    <?php if (!empty($custom_fields)): ?>
      <div class="section-title"><?php echo esc_html(__('Other information', 'kivicare-pro')); ?></div>

      <table class="data-table">
        <thead>
          <tr>
            <th><?php echo esc_html(__('Field', 'kivicare-pro')); ?></th>
            <th><?php echo esc_html(__('Value', 'kivicare-pro')); ?></th>
          </tr>
        </thead>
        <tbody>
          <?php foreach ($custom_fields as $field): ?>
            <tr>
              <td><?php echo esc_html($field['label']); ?></td>
              <td><?php echo esc_html($field['value']); ?></td>
            </tr>
          <?php endforeach; ?>
        </tbody>
      </table>
    <?php endif; ?>

    <!-- ================= SIGNATURE ================= -->
    <div class="signature">
      <?php if (!empty($doctor['signature'])): ?>
        <img src="<?php echo $doctor['signature']; ?>" style="max-width:200px;max-height:60px;">
      <?php else: ?>
        <div class="signature-line"></div>
      <?php endif; ?>
      <div class="signature-label"><?php echo esc_html(__('Doctor Signature', 'kivicare-pro')); ?></div>
    </div>

  </div>
</body>

</html>