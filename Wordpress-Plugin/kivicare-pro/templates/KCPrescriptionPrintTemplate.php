<!DOCTYPE html>
<html>

<head>
    <meta charset="UTF-8">
    <title><?php echo esc_html(__('Prescription', 'kivicare-pro')); ?></title>

    <style>
        body {
            font-family: DejaVu Sans, sans-serif;
            font-size: 12px;
            color: #333;
            margin: 0;
            padding: 20px;
        }

        /* fix: Removed max-width and margin:auto - these are unsupported for block div centering in mPDF */
        .prescription {
            width: 100%;
        }

        /* HEADER */
        .header-table {
            width: 100%;
            border-bottom: 1px solid #ddd;
            padding-bottom: 15px;
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

        /* fix: Removed border-radius - mPDF does not support border-radius on img elements */
        .logo {
            width: 50px;
            height: 50px;
        }

        .doctor-name {
            font-size: 16px;
            font-weight: bold;
            margin-top: 8px;
        }

        .doctor-title {
            font-size: 11px;
            color: #666;
            margin-bottom: 5px;
        }

        /* PATIENT INFO */
        .patient-table {
            width: 100%;
            margin-top: 15px;
            border-collapse: collapse;
        }

        .patient-table td {
            padding: 6px;
            font-size: 12px;
        }

        .label {
            font-weight: bold;
            color: #555;
        }

        /* PRESCRIPTION TABLE */
        .section-title {
            text-align: center;
            font-size: 16px;
            font-weight: bold;
            margin: 25px 0 15px;
        }

        .prescription-table {
            width: 100%;
            border-collapse: collapse;
        }

        .prescription-table th {
            font-size: 11px;
            text-align: left;
            padding: 8px;
            border-bottom: 2px solid #333;
        }

        .prescription-table td {
            padding: 8px;
            border-bottom: 1px solid #ccc;
            font-size: 11px;
        }

        /* SIGNATURE */
        .signature-section {
            margin-top: 60px;
        }

        .signature-line {
            width: 200px;
            border-bottom: 1px solid #333;
            margin-bottom: 5px;
        }

        .signature-label {
            font-size: 11px;
        }
    </style>
</head>

<!-- NO_SIMPLE_TABLES -->
<body>

    <div class="prescription">

        <!-- ================= HEADER ================= -->
        <table class="header-table">
            <tr>
                <td class="header-left">
                    <?php if (!empty($clinic_logo['url'])): ?>
                        <img src="<?php echo esc_url($clinic_logo['url']); ?>" class="logo">
                    <?php endif; ?>

                    <div class="doctor-name"><?php echo esc_html($clinic['name'] ?? ''); ?></div>
                    <div class="doctor-name"><?php echo esc_html('Dr. ' . ($doctor['name'] ?? 'N/A')); ?></div>
                    <div class="doctor-spec"><?php echo esc_html($doctor['specialization'] ?? ''); ?></div>

                    <table class="patient-table">
                        <tr>
                            <td class="label"><?php echo esc_html(__('Patient Name:', 'kivicare-pro')); ?></td>
                            <td><?php echo esc_html($patient['name']); ?></td>
                        </tr>
                        <tr>
                            <td class="label"><?php echo esc_html(__('Email:', 'kivicare-pro')); ?></td>
                            <td><?php echo esc_html($patient['email']); ?></td>
                        </tr>
                        <tr>
                            <td class="label"><?php echo esc_html(__('Blood Group:', 'kivicare-pro')); ?></td>
                            <td><?php echo esc_html($patient['blood_group']); ?></td>
                        </tr>
                        <tr>
                            <td class="label"><?php echo esc_html(__('Gender:', 'kivicare-pro')); ?></td>
                            <td><?php echo esc_html($patient['gender']); ?></td>
                        </tr>
                        <tr>
                            <td class="label"><?php echo esc_html(__('Date & Time:', 'kivicare-pro')); ?></td>
                            <td><?php echo esc_html($encounter['encounter_date']); ?></td>
                        </tr>
                    </table>
                </td>

                <td class="header-right">
                    <strong><?php echo esc_html(__('Contact:', 'kivicare-pro')); ?></strong> <?php echo esc_html($clinic['phone']); ?><br><br>
                    <strong><?php echo esc_html(__('Email:', 'kivicare-pro')); ?></strong> <?php echo esc_html($clinic['email']); ?><br><br>
                    <div><strong><?php echo esc_html(__('Address:', 'kivicare-pro')); ?></strong> 
                        <?php
                            $address_parts = array_filter([
                                $clinic['address'] ?? '',
                                $clinic['city'] ?? '',
                                $clinic['postal_code'] ?? '',
                                $clinic['country'] ?? ''
                            ]);
                            echo esc_html(implode(', ', $address_parts));
                        ?>
                    </div>
                </td>
            </tr>
        </table>

        <div class="section-title"><?php echo esc_html(__('Prescriptions', 'kivicare-pro')); ?></div>

        <?php if (!empty($prescriptions)): ?>
            <table class="prescription-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th><?php echo esc_html(__('Name', 'kivicare-pro')); ?></th>
                        <th><?php echo esc_html(__('Frequency', 'kivicare-pro')); ?></th>
                        <th><?php echo esc_html(__('Duration', 'kivicare-pro')); ?></th>
                        <th><?php echo esc_html(__('Instructions', 'kivicare-pro')); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($prescriptions as $index => $prescription): ?>
                        <tr>
                            <td><?php echo $index + 1; ?></td>
                            <td><?php echo esc_html($prescription['name']); ?></td>
                            <td><?php echo esc_html($prescription['frequency']); ?></td>
                            <td><?php echo esc_html($prescription['duration']); ?></td>
                            <td><?php echo esc_html($prescription['instruction']); ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>

        <?php if (!empty($clinical_details) && (count($clinical_details['problems']) > 0 || count($clinical_details['observations']) > 0 || count($clinical_details['notes']) > 0)): ?>
            <div class="section-title"><?php echo esc_html(__('Clinical Details', 'kivicare-pro')); ?></div>
            
            <table class="prescription-table">
                <thead>
                    <tr>
                        <th><?php echo esc_html(__('Problems', 'kivicare-pro')); ?></th>
                        <th><?php echo esc_html(__('Observations', 'kivicare-pro')); ?></th>
                        <th><?php echo esc_html(__('Notes', 'kivicare-pro')); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="vertical-align: top;">
                            <?php if (!empty($clinical_details['problems'])): ?>
                                <!-- fix: Changed padding-left to margin-left for mPDF list indent compatibility -->
                                <ul style="margin: 0; margin-left: 15px;">
                                    <?php foreach ($clinical_details['problems'] as $problem): ?>
                                        <li><?php echo esc_html($problem['title']); ?></li>
                                    <?php endforeach; ?>
                                </ul>
                            <?php else: ?>
                                -
                            <?php endif; ?>
                        </td>
                        <td style="vertical-align: top;">
                            <?php if (!empty($clinical_details['observations'])): ?>
                                <ul style="margin: 0; margin-left: 15px;">
                                    <?php foreach ($clinical_details['observations'] as $observation): ?>
                                        <li><?php echo esc_html($observation['title']); ?></li>
                                    <?php endforeach; ?>
                                </ul>
                            <?php else: ?>
                                -
                            <?php endif; ?>
                        </td>
                        <td style="vertical-align: top;">
                            <?php if (!empty($clinical_details['notes'])): ?>
                                <ul style="margin: 0; margin-left: 15px;">
                                    <?php foreach ($clinical_details['notes'] as $note): ?>
                                        <li><?php echo esc_html($note['title']); ?></li>
                                    <?php endforeach; ?>
                                </ul>
                            <?php else: ?>
                                -
                            <?php endif; ?>
                        </td>
                    </tr>
                </tbody>
            </table>
        <?php endif; ?>

        <?php if (!empty($custom_fields)): ?>
            <div class="section-title"><?php echo esc_html(__('Other information', 'kivicare-pro')); ?></div>
            
            <table class="prescription-table">
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

        <div class="signature-section">
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