<?php
namespace KCProApp\helper;
defined('ABSPATH') || exit;

/**
 * Class KCPTaxCalculator
 *
 * Calculates taxes for multiple services with different tax configurations.
 * Supports service-specific taxes and taxes that apply to multiple services.
 */
class KCPTaxCalculator
{
    protected $services = [];
    protected $tax_mode; // 'exclude' or 'include'
    protected $tax_definitions = [];
    protected $calculated_taxes = [];
    protected $service_totals = [];
    protected $total_tax = 0.0;
    protected $grand_total = 0.0;

    /**
     * Constructor.
     *
     * @param array $services Array of services with their details
     *                       [['id' => 1, 'name' => 'Service 1', 'price' => 100.0, 'quantity' => 1], ...]
     * @param string $tax_mode ('exclude' or 'include')
     * @param array $tax_definitions Tax definitions with service mappings
     *                              [['id' => 1, 'name' => 'VAT', 'type' => 'percentage', 'value' => 18.0, 'services' => [1, 2]], ...]
     */
    public function __construct($services = [], $tax_mode = 'exclude', $tax_definitions = [])
    {
        $this->services = $services;
        $this->tax_mode = in_array($tax_mode, ['exclude', 'include']) ? $tax_mode : 'exclude';
        $this->tax_definitions = $tax_definitions;
        $this->calculate();
    }

    /**
     * Add a service to the calculator.
     *
     * @param int $service_id
     * @param string $service_name
     * @param float $price
     * @param int $quantity
     * @return $this
     */
    public function addService($service_id, $service_name, $price, $quantity = 1)
    {
        $this->services[] = [
            'id' => $service_id,
            'name' => $service_name,
            'price' => floatval($price),
            'quantity' => intval($quantity)
        ];
        return $this;
    }

    /**
     * Add a tax definition.
     *
     * @param int $tax_id
     * @param string $tax_name
     * @param string $tax_type ('percentage' or 'fixed')
     * @param float $tax_value
     * @param array $applicable_services Array of service IDs this tax applies to
     * @return $this
     */
    public function addTax($tax_id, $tax_name, $tax_type, $tax_value, $applicable_services = [])
    {
        $this->tax_definitions[] = [
            'id' => $tax_id,
            'name' => $tax_name,
            'type' => $tax_type,
            'value' => floatval($tax_value),
            'services' => $applicable_services
        ];
        return $this;
    }

    /**
     * Calculate all taxes for all services.
     *
     * @return $this
     */
    public function calculate()
    {
        $this->calculated_taxes = [];
        $this->service_totals = [];
        $this->total_tax = 0.0;
        $this->grand_total = 0.0;

        // Calculate taxes for each service
        foreach ($this->services as $service) {
            $this->calculateServiceTax($service);
        }

        return $this;
    }

    /**
     * Calculate tax for a specific service.
     *
     * @param array $service
     */
    protected function calculateServiceTax($service)
    {
        $service_id = $service['id'];
        $service_name = $service['name'];
        $amount = $service['price'] * $service['quantity'];

        // Find applicable taxes for this service
        $applicable_taxes = $this->getApplicableTaxes($service_id);

        $service_tax_total = 0.0;
        $service_calculated_taxes = [];

        if ($this->tax_mode === 'exclude') {
            // Tax excluded from price
            foreach ($applicable_taxes as $tax) {
                $tax_amount = $this->calculateTaxAmount($tax, $amount, $service['quantity']);
                
                $service_calculated_taxes[] = [
                    'tax_id' => $tax['id'],
                    'tax_name' => $tax['name'],
                    'tax_type' => $tax['type'],
                    'tax_value' => $tax['value'],
                    'tax_amount' => $tax_amount,
                    'service_id' => $service_id,
                    'service_name' => $service_name
                ];

                $service_tax_total += $tax_amount;
            }
        } else {
            // Tax included in price
            $service_tax_total = $this->calculateIncludedTax($applicable_taxes, $amount, $service['quantity']);
            
            foreach ($applicable_taxes as $tax) {
                $tax_amount = $this->calculateIncludedTaxAmount($tax, $applicable_taxes, $amount, $service['quantity']);
                
                $service_calculated_taxes[] = [
                    'tax_id' => $tax['id'],
                    'tax_name' => $tax['name'],
                    'tax_type' => $tax['type'],
                    'tax_value' => $tax['value'],
                    'tax_amount' => $tax_amount,
                    'service_id' => $service_id,
                    'service_name' => $service_name
                ];
            }
        }

        // Store service totals
        $this->service_totals[$service_id] = [
            'service_id' => $service_id,
            'service_name' => $service_name,
            'base_amount' => $amount,
            'tax_amount' => $service_tax_total,
            'total_amount' => $amount + ($this->tax_mode === 'exclude' ? $service_tax_total : 0),
            'taxes' => $service_calculated_taxes
        ];

        // Add to overall calculated taxes
        $this->calculated_taxes = array_merge($this->calculated_taxes, $service_calculated_taxes);
        $this->total_tax += $service_tax_total;
        $this->grand_total += $amount + ($this->tax_mode === 'exclude' ? $service_tax_total : 0);
    }

    /**
     * Get taxes applicable to a specific service.
     *
     * @param int $service_id
     * @return array
     */
    protected function getApplicableTaxes($service_id)
    {
        $applicable_taxes = [];
        
        foreach ($this->tax_definitions as $tax) {
            if (empty($tax['services']) || in_array($service_id, $tax['services'])) {
                $applicable_taxes[] = $tax;
            }
        }
        
        return $applicable_taxes;
    }

    /**
     * Calculate tax amount for excluded tax mode.
     *
     * @param array $tax
     * @param float $amount
     * @param int $quantity
     * @return float
     */
    protected function calculateTaxAmount($tax, $amount, $quantity)
    {
        if ($tax['type'] === 'percentage') {
            return ($amount * $tax['value']) / 100;
        } else {
            return $tax['value'];
        }
    }

    /**
     * Calculate total included tax for a service.
     *
     * @param array $applicable_taxes
     * @param float $amount
     * @param int $quantity
     * @return float
     */
    protected function calculateIncludedTax($applicable_taxes, $amount, $quantity)
    {
        $total_percentage = 0.0;
        $fixed_total = 0.0;

        foreach ($applicable_taxes as $tax) {
            if ($tax['type'] === 'percentage') {
                $total_percentage += $tax['value'];
            } else {
                $fixed_total += $tax['value'];
            }
        }

        $base_amount = $amount - $fixed_total;
        if ($total_percentage > 0) {
            $base_amount = $base_amount / (1 + $total_percentage / 100);
        }

        return $amount - $base_amount;
    }

    /**
     * Calculate individual tax amount for included tax mode.
     *
     * @param array $tax
     * @param array $applicable_taxes
     * @param float $amount
     * @param int $quantity
     * @return float
     */
    protected function calculateIncludedTaxAmount($tax, $applicable_taxes, $amount, $quantity)
    {
        $total_percentage = 0.0;
        $fixed_total = 0.0;

        foreach ($applicable_taxes as $t) {
            if ($t['type'] === 'percentage') {
                $total_percentage += $t['value'];
            } else {
                $fixed_total += $t['value'];
            }
        }

        $base_amount = $amount - $fixed_total;
        if ($total_percentage > 0) {
            $base_amount = $base_amount / (1 + $total_percentage / 100);
        }

        if ($tax['type'] === 'percentage') {
            return $base_amount * $tax['value'] / 100;
        } else {
            return $tax['value'];
        }
    }

    /**
     * Get total tax amount across all services.
     *
     * @return float
     */
    public function getTotalTax()
    {
        return $this->total_tax;
    }

    /**
     * Get grand total including all services and taxes.
     *
     * @return float
     */
    public function getGrandTotal()
    {
        return $this->grand_total;
    }

    /**
     * Get calculated taxes breakdown for all services.
     *
     * @return array
     */
    public function getCalculatedTaxes()
    {
        return $this->calculated_taxes;
    }

    /**
     * Get service-wise totals.
     *
     * @return array
     */
    public function getServiceTotals()
    {
        return $this->service_totals;
    }

    /**
     * Get taxes for a specific service.
     *
     * @param int $service_id
     * @return array
     */
    public function getServiceTaxes($service_id)
    {
        return isset($this->service_totals[$service_id]) ? $this->service_totals[$service_id] : [];
    }

    /**
     * Get tax summary grouped by tax type.
     *
     * @return array
     */
    public function getTaxSummary()
    {
        $summary = [];
        
        foreach ($this->calculated_taxes as $tax) {
            $tax_id = $tax['tax_id'];
            
            if (!isset($summary[$tax_id])) {
                $summary[$tax_id] = [
                    'tax_id' => $tax_id,
                    'tax_name' => $tax['tax_name'],
                    'tax_type' => $tax['tax_type'],
                    'tax_value' => $tax['tax_value'],
                    'total_amount' => 0.0,
                    'services' => []
                ];
            }
            
            $summary[$tax_id]['total_amount'] += $tax['tax_amount'];
            $summary[$tax_id]['services'][] = [
                'service_id' => $tax['service_id'],
                'service_name' => $tax['service_name'],
                'tax_amount' => $tax['tax_amount']
            ];
        }
        
        return array_values($summary);
    }

    /**
     * Recalculate taxes (useful after adding services or taxes).
     *
     * @return $this
     */
    public function recalculate()
    {
        return $this->calculate();
    }
}