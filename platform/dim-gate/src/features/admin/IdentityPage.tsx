import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import type { SessionView, User, Team } from '../../domain/schemas'

function UserRow({ user, teams, actorId, committed }: { user: User; teams: Team[]; actorId: string; committed: () => Promise<unknown> }) {
  const [name, setName] = useState(user.displayName)
  const [teamIds, setTeamIds] = useState(user.teamIds)
  const [reason, setReason] = useState('Update Demo membership')
  const mutation = useMutation({ mutationFn: (enabled?: boolean) => api.updateAdminUser(user.id,
    { expectedVersion: user.version, displayName: name, teamIds, ...(enabled === undefined ? {} : { enabled }), reason }) })
  const save = async (enabled?: boolean) => { try { await mutation.mutateAsync(enabled); await committed() } catch { /* exact refusal shown below */ } }
  return <tr><th scope="row"><input aria-label={`${user.id} 顯示名稱`} value={name} onChange={event => setName(event.target.value)} />
    <small><code>{user.id}</code> · {user.source === 'demo' ? 'Demo 資料；無登入身分' : '預設示範身分'}</small></th>
    <td><select aria-label={`${user.id} 所屬團隊`} multiple value={teamIds} onChange={event => setTeamIds(Array.from(event.currentTarget.selectedOptions, option => option.value))}>
      {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
    </select><small>團隊成員資格不授予角色</small></td><td>{user.enabled ? '啟用' : '停用'}</td>
    <td><label>變更理由<input aria-label={`${user.id} 變更理由`} required value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="request-actions"><Button size="sm" disabled={mutation.isPending || !reason.trim()} onClick={() => void save()}>儲存</Button>
        <Button size="sm" variant="outline" disabled={mutation.isPending || user.id === actorId || !reason.trim()}
          onClick={() => void save(!user.enabled)}>{user.enabled ? '停用' : '啟用'}</Button></div>
      {user.id === actorId && <small>目前身分不可自行停用</small>}
      {mutation.isError && <ErrorState error={mutation.error} title="使用者未更新" />}</td></tr>
}

function TeamRow({ team, committed }: { team: Team; committed: () => Promise<unknown> }) {
  const [name, setName] = useState(team.name)
  const [reason, setReason] = useState('Update Demo team')
  const mutation = useMutation({ mutationFn: () => api.patchAdminTeam(team.id, team.version, name, reason) })
  return <tr><th scope="row"><input aria-label={`${team.id} 團隊名稱`} value={name} onChange={event => setName(event.target.value)} />
    <small><code>{team.id}</code> · {team.source}</small></th><td><code>{team.businessUnitId}</code></td><td>
      <label>變更理由<input aria-label={`${team.id} 變更理由`} required value={reason} onChange={event => setReason(event.target.value)} /></label>
      <Button size="sm" disabled={mutation.isPending || !reason.trim() || !name.trim()} onClick={async () => {
        try { await mutation.mutateAsync(); await committed() } catch { /* exact refusal shown below */ }
      }}>儲存名稱</Button>{mutation.isError && <ErrorState error={mutation.error} title="團隊未更新" />}</td></tr>
}

export function IdentityPage({ session }: { session: SessionView }) {
  const [userPage, setUserPage] = useState(1)
  const [teamPage, setTeamPage] = useState(1)
  const users = useQuery({ queryKey: queryKey('admin-users', null, { page: userPage }), queryFn: () => api.listAdminUsers(userPage, 25) })
  const teams = useQuery({ queryKey: queryKey('admin-teams', null, { page: teamPage }), queryFn: () => api.listAdminTeams(teamPage, 25) })
  const [userForm, setUserForm] = useState({ displayName: '', teamIds: [] as string[], enabled: true, reason: 'Create local Demo user' })
  const [teamForm, setTeamForm] = useState({ businessUnitId: 'bu-technology', name: '', reason: 'Create local Demo team' })
  const createUser = useMutation({ mutationFn: () => api.createAdminUser(userForm) })
  const createTeam = useMutation({ mutationFn: () => api.createAdminTeam(teamForm) })
  const submitUser = async (event: FormEvent) => { event.preventDefault(); try {
    await createUser.mutateAsync(); setUserForm({ ...userForm, displayName: '', teamIds: [] }); await users.refetch()
  } catch { /* exact refusal shown below */ } }
  const submitTeam = async (event: FormEvent) => { event.preventDefault(); try {
    await createTeam.mutateAsync(); setTeamForm({ ...teamForm, name: '' }); await teams.refetch()
  } catch { /* exact refusal shown below */ } }
  const refresh = async () => { await Promise.all([users.refetch(), teams.refetch()]) }
  if (users.isPending || teams.isPending) return <LoadingState label="正在讀取 Demo 使用者與團隊…" />
  if (users.isError) return <ErrorState error={users.error} onRetry={() => void users.refetch()} />
  if (teams.isError) return <ErrorState error={teams.error} onRetry={() => void teams.refetch()} />
  const units = [...new Set(teams.data.items.map(team => team.businessUnitId))]
  return <><PageHeading eyebrow="ADMIN · DEMO IDENTITY" title="使用者與團隊" description="這裡只管理本地 Mock 資料。新使用者沒有角色授權，也不會出現在示範登入選單；團隊成員資格不授予操作權。" />
    <div className="request-actions"><Button asChild variant="outline"><Link to="/admin/access">查看角色授權與 policy version</Link></Button></div>
    <form className="panel admin-form" onSubmit={event => void submitUser(event)}><div className="panel-title"><h2>建立 Demo 使用者</h2></div>
      <label>顯示名稱<input required maxLength={120} value={userForm.displayName} onChange={event => setUserForm({ ...userForm, displayName: event.target.value })} /></label>
      <label>團隊<select aria-label="新使用者所屬團隊" multiple value={userForm.teamIds} onChange={event => setUserForm({ ...userForm,
        teamIds: Array.from(event.currentTarget.selectedOptions, option => option.value) })}>{teams.data.items.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>啟用<select value={String(userForm.enabled)} onChange={event => setUserForm({ ...userForm, enabled: event.target.value === 'true' })}><option value="true">是</option><option value="false">否</option></select></label>
      <label>理由<input required value={userForm.reason} onChange={event => setUserForm({ ...userForm, reason: event.target.value })} /></label>
      <div className="form-actions span-all"><Button type="submit" disabled={createUser.isPending}>建立使用者</Button></div></form>
    {createUser.isError && <ErrorState error={createUser.error} title="使用者未建立" />}
    {createUser.isSuccess && <p role="status" className="command-notice">使用者已建立；目前沒有授權或登入身分。</p>}
    <section className="panel table-scroll"><table><caption>目前可見使用者；共 {users.data.total} 筆</caption><thead><tr><th>使用者</th><th>團隊</th><th>狀態</th><th>編輯</th></tr></thead><tbody>
      {users.data.items.map(user => <UserRow key={`${user.id}:${user.version}`} user={user} teams={teams.data.items} actorId={session.user.id} committed={refresh} />)}
    </tbody></table><div className="request-actions"><Button variant="outline" disabled={userPage === 1} onClick={() => setUserPage(userPage - 1)}>上一頁</Button>
      <span>第 {userPage} 頁</span><Button variant="outline" disabled={userPage * 25 >= users.data.total} onClick={() => setUserPage(userPage + 1)}>下一頁</Button></div></section>
    <form className="panel admin-form" onSubmit={event => void submitTeam(event)}><div className="panel-title"><h2>建立 Demo 團隊</h2></div>
      <label>業務單位<select value={teamForm.businessUnitId} onChange={event => setTeamForm({ ...teamForm, businessUnitId: event.target.value })}>
        {units.map(id => <option key={id} value={id}>{id}</option>)}</select></label>
      <label>團隊名稱<input required maxLength={120} value={teamForm.name} onChange={event => setTeamForm({ ...teamForm, name: event.target.value })} /></label>
      <label>理由<input required value={teamForm.reason} onChange={event => setTeamForm({ ...teamForm, reason: event.target.value })} /></label>
      <div className="form-actions span-all"><Button type="submit" disabled={createTeam.isPending}>建立團隊</Button></div></form>
    {createTeam.isError && <ErrorState error={createTeam.error} title="團隊未建立" />}
    <section className="panel table-scroll"><table><caption>目前可見團隊；共 {teams.data.total} 筆</caption><thead><tr><th>團隊</th><th>業務單位</th><th>編輯</th></tr></thead><tbody>
      {teams.data.items.map(team => <TeamRow key={`${team.id}:${team.version}`} team={team} committed={refresh} />)}
    </tbody></table><div className="request-actions"><Button variant="outline" disabled={teamPage === 1} onClick={() => setTeamPage(teamPage - 1)}>上一頁</Button>
      <span>第 {teamPage} 頁</span><Button variant="outline" disabled={teamPage * 25 >= teams.data.total} onClick={() => setTeamPage(teamPage + 1)}>下一頁</Button></div></section>
  </>
}
