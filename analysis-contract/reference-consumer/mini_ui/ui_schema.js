/**
 * SIREN Visual Builder — Mini UI Builder Schema & Specification (Section 8)
 * Demonstrates binding visual UI controls (inputs, button, display) to visually-built Python functions.
 */

export const UI_CONTROL_TYPES = {
  INPUT_FIELD: 'input_field',
  BUTTON: 'button',
  RESULT_DISPLAY: 'result_display'
};

export function createMiniUiForm() {
  return {
    schemaVersion: 'siren.mini-ui-form/1.0.0',
    title: 'Financial VAT & Net Calculator',
    controls: [
      {
        id: 'ctrl_gross_amount',
        type: UI_CONTROL_TYPES.INPUT_FIELD,
        label: 'Gross Amount (RON)',
        dataType: 'number',
        defaultValue: 1000.0,
        x: 40,
        y: 40,
        width: 200
      },
      {
        id: 'ctrl_discount_rate',
        type: UI_CONTROL_TYPES.INPUT_FIELD,
        label: 'Discount Rate (0.0 - 1.0)',
        dataType: 'number',
        defaultValue: 0.10,
        x: 40,
        y: 110,
        width: 200
      },
      {
        id: 'ctrl_calc_btn',
        type: UI_CONTROL_TYPES.BUTTON,
        label: 'Calculate Net & VAT',
        x: 40,
        y: 180,
        width: 200,
        bindFunction: 'func_calculate_financials',
        inputBindings: {
          gross: 'ctrl_gross_amount',
          discount: 'ctrl_discount_rate'
        },
        outputBinding: 'ctrl_total_display'
      },
      {
        id: 'ctrl_total_display',
        type: UI_CONTROL_TYPES.RESULT_DISPLAY,
        label: 'Calculated Net Total (RON)',
        x: 40,
        y: 240,
        width: 240,
        value: null,
        formattedText: 'Awaiting calculation...'
      }
    ],
    boundLogic: {
      functionName: 'func_calculate_financials',
      pythonTemplate: `
def func_calculate_financials(gross, discount):
    gross_val = float(gross)
    disc_val = float(discount)
    net_before_vat = round(gross_val * (1.0 - disc_val), 2)
    vat_amount = round(net_before_vat * 0.19, 2)
    final_net_total = round(net_before_vat + vat_amount, 2)
    return {
        "net_before_vat": net_before_vat,
        "vat_amount": vat_amount,
        "final_net_total": final_net_total,
        "display_text": f"{final_net_total:.2f} RON (Net: {net_before_vat:.2f}, VAT 19%: {vat_amount:.2f})"
    }
`
    }
  };
}
