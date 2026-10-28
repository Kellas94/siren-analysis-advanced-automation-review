// Deliberate bootstrap refusal before ready/worker, not actual store corruption.
export async function createProvider(){throw Object.assign(new Error('Controlled pre-ready history refusal'),{code:'HISTORY_INVALID_STATE'});}
