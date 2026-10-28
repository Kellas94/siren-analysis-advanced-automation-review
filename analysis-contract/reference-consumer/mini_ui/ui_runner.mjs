/**
 * SIREN Visual Builder — Mini UI Runner
 * Binds UI inputs to Python function execution and updates the UI state with real results.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTOTYPE_ROOT = path.resolve(__dirname, '..');

export class MiniUiRunner {
  constructor(options = {}) {
    const defaultVenv = path.join(PROTOTYPE_ROOT, '.venv/Scripts/python.exe');
    this.pythonPath = options.pythonPath || (fs.existsSync(defaultVenv) ? defaultVenv : 'C:\\Program Files\\Python312\\python.exe');
    this.scratchDir = path.join(PROTOTYPE_ROOT, 'data/scratch');
    if (!fs.existsSync(this.scratchDir)) fs.mkdirSync(this.scratchDir, { recursive: true });
  }

  async triggerButton(form, inputValues = {}) {
    const btn = form.controls.find(c => c.type === 'button');
    if (!btn || !btn.bindFunction) {
      throw new Error('No executable button found in form');
    }

    const funcDef = form.boundLogic.pythonTemplate;
    const scriptPath = path.join(this.scratchDir, `mini_ui_${Date.now()}.py`);

    // Prepare inputs
    const gross = inputValues.gross !== undefined ? inputValues.gross : form.controls.find(c => c.id === 'ctrl_gross_amount').defaultValue;
    const discount = inputValues.discount !== undefined ? inputValues.discount : form.controls.find(c => c.id === 'ctrl_discount_rate').defaultValue;

    const fullScript = `
import sys
import json

${funcDef}

if __name__ == "__main__":
    res = func_calculate_financials(${gross}, ${discount})
    print(json.dumps(res))
`;

    fs.writeFileSync(scriptPath, fullScript, 'utf-8');

    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, ['-u', scriptPath]);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });

      child.on('close', code => {
        if (code !== 0) {
          return reject(new Error(`Mini UI execution failed: ${stderr || 'Unknown error'}`));
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          // Update form output control state
          const displayCtrl = form.controls.find(c => c.id === btn.outputBinding);
          if (displayCtrl) {
            displayCtrl.value = parsed.final_net_total;
            displayCtrl.formattedText = parsed.display_text;
          }

          resolve({
            formState: JSON.parse(JSON.stringify(form)),
            result: parsed
          });
        } catch (err) {
          reject(new Error(`Failed to parse Python output: ${err.message}`));
        }
      });
    });
  }
}
