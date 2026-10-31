/** Renderer-neutral public projection. Never interprets strings as HTML. */
const labels = Object.freeze({coding: '寫程式', terminal: '終端中', browsing: '瀏覽網頁', thinking: '思考中', 'needs-you': '需要你', error: '出錯', idle: '空閒', done: '已完成'});
const desks = {director: [4, 3], 'desk-1': [10, 8], 'desk-2': [14, 8], 'desk-3': [18, 8]};
const meeting = [[15, 3], [17, 2], [19, 2], [21, 3]];
const rest = [[3, 12], [5, 12], [7, 12]];
const hasStatus = value => typeof value === 'string' && Object.hasOwn(labels, value);
const ordered = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export function isNight(time) {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid scene time');
  const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Singapore', hour: '2-digit', hourCycle: 'h23'}).format(date));
  return hour >= 22 || hour < 8;
}
export function present(state, {nightEnabled = false, connected = true} = {}) {
  if (typeof connected !== 'boolean' || typeof nightEnabled !== 'boolean') throw new Error('invalid scene options');
  if (!state || state.schemaVersion !== 1 || !['live', 'demo'].includes(state.mode) || state.simulated !== (state.mode === 'demo') || !Array.isArray(state.bots) || state.bots.length > 16) throw new Error('invalid public state');
  const bots = [...state.bots];
  const ids = new Set();
  for (const bot of bots) {
    if (!bot || typeof bot.id !== 'string' || ids.has(bot.id) || !hasStatus(bot.status) || !hasStatus(bot.reportedStatus) || typeof bot.stale !== 'boolean' || typeof bot.alert !== 'boolean' || !Array.isArray(bot.collaborators) || bot.collaborators.some(id => typeof id !== 'string') || !['name', 'role', 'summary', 'seat'].every(key => typeof bot[key] === 'string')) throw new Error('invalid public bot');
    ids.add(bot.id);
  }
  bots.sort(ordered);
  const night = nightEnabled ? isNight(state.serverTime) : false;
  const alert = bot => bot.alert || [bot.status, bot.reportedStatus].some(status => ['needs-you', 'error'].includes(status));
  const active = bot => connected && !bot.stale && !alert(bot) && !['idle', 'done'].includes(bot.status);
  // At most two disjoint, mutually consenting pairs fit the four meeting seats.
  // Stable ID ordering, not incoming JSON order, determines selection and seats.
  const selected = new Set();
  for (const bot of bots) {
    if (selected.size >= meeting.length || selected.has(bot.id) || !active(bot)) continue;
    const peer = bots.find(other => other.id !== bot.id && !selected.has(other.id) && active(other) && bot.collaborators.includes(other.id) && other.collaborators.includes(bot.id));
    if (peer) { selected.add(bot.id); selected.add(peer.id); }
  }
  const seated = bots.filter(bot => selected.has(bot.id));
  return {
    mode: state.mode, simulated: state.simulated, connected,
    banner: connected ? (state.simulated ? '模擬資料' : '即時上報資料') : '連線中斷：顯示最後成功取得的資料',
    bots: bots.map((bot, index) => {
      const needsAttention = alert(bot);
      let zone = 'desk'; let position = Object.hasOwn(desks, bot.seat) ? desks[bot.seat] : null;
      if (connected && !needsAttention) {
        if (night && (bot.stale || bot.status === 'idle')) { zone = 'exit'; position = [23, 14]; }
        else if (bot.stale) { zone = 'desk'; }
        else if (selected.has(bot.id)) { zone = 'meeting'; position = meeting[seated.findIndex(other => other.id === bot.id)]; }
        else if (bot.status === 'idle') { zone = 'rest'; position = rest[index % rest.length]; }
      }
      const visibleStatus = ['needs-you', 'error'].includes(bot.reportedStatus) ? bot.reportedStatus : bot.status;
      return {id: bot.id, name: bot.name, role: bot.role, summary: bot.summary,
        status: bot.status, reportedStatus: bot.reportedStatus, label: labels[visibleStatus],
        stale: bot.stale, alert: needsAttention, zone, position: position ? [...position] : null,
        movable: connected && !bot.stale && !needsAttention,
        badges: [...(state.simulated ? ['模擬資料'] : []), ...(!connected ? ['連線中斷'] : []), ...(bot.stale ? ['資料過期'] : []), ...(needsAttention ? ['需要注意'] : [])]};
    })
  };
}
