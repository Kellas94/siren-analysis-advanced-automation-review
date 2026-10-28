/**
 * SIREN Analysis Snapshot Worker — IPC Protocol Definition & Message Types
 *
 * Enforces strict request/reply binding with:
 *   (jobId, attemptId, sessionToken)
 *
 * Guarantees:
 *   - Delayed or reversed responses from old/cancelled attempts are detected and discarded.
 *   - Attributions record real child worker PID and runtime version.
 */

export const MessageTypes = Object.freeze({
  EXECUTE_REQUEST: 'EXECUTE_REQUEST',
  EXECUTE_SUCCESS: 'EXECUTE_SUCCESS',
  EXECUTE_FAILURE: 'EXECUTE_FAILURE',
  CANCEL_REQUEST: 'CANCEL_REQUEST',
  CANCEL_ACK: 'CANCEL_ACK',
  CRASH_INJECT: 'CRASH_INJECT',
  SHUTDOWN_REQUEST: 'SHUTDOWN_REQUEST',
  SHUTDOWN_ACK: 'SHUTDOWN_ACK'
});

/**
 * Validates that an incoming IPC message has matching session tokens.
 *
 * @param {Object} msg - Incoming reply from child
 * @param {Object} expected - Current active attempt expectation { jobId, attemptId, sessionToken }
 * @returns {boolean} True if strictly matches; false if stale/delayed/reversed reply
 */
export function validateSessionBinding(msg, expected) {
  if (!msg || typeof msg !== 'object') return false;
  if (!expected || typeof expected !== 'object') return false;

  return (
    msg.jobId === expected.jobId &&
    msg.attemptId === expected.attemptId &&
    msg.sessionToken === expected.sessionToken
  );
}
