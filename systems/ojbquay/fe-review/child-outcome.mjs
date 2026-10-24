export function childFailure(outcome) {
  if(outcome.timedOut)return 'REVIEW_'+outcome.label.toUpperCase()+'_TIMEOUT';
  if(outcome.exitCode!==0||outcome.signal)return 'REVIEW_'+outcome.label.toUpperCase()+'_EXIT';
  if(!outcome.cleanup)return 'REVIEW_CHILD_CLEANUP';
  return null;
}
