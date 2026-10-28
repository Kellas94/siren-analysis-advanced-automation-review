// Standalone UI callable wrapper. No analytical graph, DuckDB or data operators.
export function generateUiPython(definition){
 if(definition.kind!=='ui-python')throw new Error('UI_FUNCTION_REQUIRED');
 const encoded=JSON.stringify(JSON.stringify(definition));
 return `# SIREN independent UI Python function\nimport sys, json, math, traceback\nfrom decimal import Decimal\n\n_ui_definition = json.loads(${encoded})\n`+String.raw`
def _ui_value(value, kind, nullable=False):
    if value is None:
        if nullable:
            return None
        raise ValueError('NULL_NOT_ALLOWED')
    if kind == 'string':
        if not isinstance(value, str):
            raise ValueError('STRING_REQUIRED')
        return value
    if kind == 'boolean':
        if not isinstance(value, bool):
            raise ValueError('BOOLEAN_REQUIRED')
        return value
    if kind == 'integer':
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            raise ValueError('EXACT_INTEGER_REQUIRED')
        text = str(value)
        if not text or text.lstrip('+-').isdigit() is False or len(text) > 512:
            raise ValueError('EXACT_INTEGER_REQUIRED')
        return int(text)
    if kind == 'decimal':
        if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
            raise ValueError('EXACT_DECIMAL_REQUIRED')
        number = Decimal(value)
        if not number.is_finite():
            raise ValueError('FINITE_DECIMAL_REQUIRED')
        return number
    if kind == 'number':
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError('FINITE_NUMBER_REQUIRED')
        if (isinstance(value, int) or value.is_integer()) and abs(value) > 9007199254740991:
            raise ValueError('UNSAFE_NUMBER_USE_INTEGER')
        return value
    if kind == 'json':
        _ui_wire(value)
        return value
    raise ValueError('UNSUPPORTED_UI_TYPE: ' + str(kind))

def _ui_wire(value):
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return str(value) if abs(value) > 9007199254740991 else value
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError('NONFINITE_DECIMAL_RESULT')
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError('NONFINITE_NUMBER_RESULT')
        if value.is_integer() and abs(value) > 9007199254740991:
            raise ValueError('UNSAFE_NUMBER_USE_INTEGER')
        return value
    if isinstance(value, list):
        return [_ui_wire(item) for item in value]
    if isinstance(value, dict) and all(isinstance(k, str) for k in value):
        return {k: _ui_wire(v) for k, v in value.items()}
    raise ValueError('NON_JSON_UI_RESULT')

def _ui_run():
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError('PARAMETER_MAP_REQUIRED')
    signature = _ui_definition['parameters']
    expected = {p['name'] for p in signature}
    if set(payload) != expected:
        raise ValueError('UI_PARAMETER_IDENTITY_MISMATCH')
    arguments = {p['name']: _ui_value(payload[p['name']], p['type'], not p.get('required', True)) for p in signature}
    scope = {'Decimal': Decimal}
    exec(compile(_ui_definition['source'], '<ui-function:' + _ui_definition['id'] + '>', 'exec'), scope)
    entry = scope.get(_ui_definition['entryPoint'])
    if not callable(entry):
        raise ValueError('UI_ENTRY_POINT_NOT_CALLABLE')
    result = entry(**arguments)
    if not isinstance(result, dict):
        raise ValueError('UI_RETURN_OBJECT_REQUIRED')
    for field in _ui_definition['returns']:
        if field['name'] not in result:
            raise ValueError('UI_RETURN_FIELD_MISSING: ' + field['name'])
        result[field['name']] = _ui_value(result[field['name']], field['type'], field.get('nullable', False))
    return _ui_wire(result)

if __name__ == '__main__':
    try:
        value = _ui_run()
        print('\nSIREN_UI_RESULT_V1 ' + json.dumps({'status': 'COMPLETED', 'result': value}, ensure_ascii=True, allow_nan=False))
    except BaseException as error:
        traceback.print_exc(file=sys.stderr)
        print('\nSIREN_UI_RESULT_V1 ' + json.dumps({'status': 'FAILED', 'error': str(error)}, ensure_ascii=True, allow_nan=False))
        sys.exit(1)
`;
}
