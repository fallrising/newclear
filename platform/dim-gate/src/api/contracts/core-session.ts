import type { ContractContext } from '../contracts.ts'

export function registerCoreSessionContracts({ z, d, w, s, id, read, command }: ContractContext) {
  read('/session', 'getSession', s.SessionView, 'M0')
  read('/organization', 'getOrganization', w.OrganizationView, 'M0')
  read('/navigation', 'getNavigation', z.array(s.NavigationItem), 'M0', z.strictObject({ center: d.centerSchema }))
  read('/dashboard', 'getDashboard', s.DashboardView, 'M0', z.strictObject({ center: d.centerSchema, projectId: id.optional(), environmentId: id.optional() }))
  command('delete', '/admin/assignments/{id}', 'revokeAssignment', s.RevokeAssignment, 'M0')
  read('/personas', 'getPersonas', z.array(s.Persona), 'M0', undefined, true)
  read('/guide', 'getGuide', s.GuideView, 'M0', undefined, true)
  command('post', '/persona', 'setPersona', w.PersonaBody, 'M0', 200, true, w.ControlResult)
  command('post', '/reset', 'resetDemo', w.ResetBody, 'M0', 200, true, w.ControlResult)
  command('post', '/clock/advance', 'advanceClock', s.AdvanceClock, 'M0', 200, true)
}

export const coreSessionFamilies = ['session', 'organization', 'navigation', 'dashboard', 'personas', 'guide'] as const
