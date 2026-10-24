export function enabledAction(snapshot) {
  return snapshot?.present === true && snapshot.id === 'act-hello-redeploy' && snapshot.rowId === 'row-hello' && snapshot.disabled === false;
}
