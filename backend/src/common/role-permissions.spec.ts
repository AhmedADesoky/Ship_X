import { ALL_PERMISSIONS, effectivePermissions, ROLE_PERMISSIONS } from './role-permissions';

describe('role-permissions', () => {
  it('EMPLOYEE has no baked-in default permissions', () => {
    expect(ROLE_PERMISSIONS.EMPLOYEE).toEqual([]);
  });

  it('a fresh EMPLOYEE with no extra grants has zero effective permissions', () => {
    expect(effectivePermissions('EMPLOYEE', [])).toEqual([]);
  });

  it('an EMPLOYEE granted exactly one extra permission has exactly that one', () => {
    expect(effectivePermissions('EMPLOYEE', ['view_reports'])).toEqual(['view_reports']);
  });

  it('ROLE_PERMISSIONS still lists a non-empty suggested default for OWNER/MANAGER/ACCOUNTANT (used only as the create-dialog starting checklist, not a runtime floor)', () => {
    expect(ROLE_PERMISSIONS.OWNER.length).toBeGreaterThan(0);
    expect(ROLE_PERMISSIONS.MANAGER.length).toBeGreaterThan(0);
    expect(ROLE_PERMISSIONS.ACCOUNTANT.length).toBeGreaterThan(0);
  });

  it('OWNER always has the full fixed list, ignoring extra entirely', () => {
    expect(effectivePermissions('OWNER', [])).toEqual(ROLE_PERMISSIONS.OWNER);
    expect(effectivePermissions('OWNER', ['manage_users'])).toEqual(ROLE_PERMISSIONS.OWNER);
    // Even an attempt to strip permissions via `extra` has no effect for OWNER.
    expect(effectivePermissions('OWNER', [])).toEqual(expect.arrayContaining(ROLE_PERMISSIONS.OWNER));
  });

  it('MANAGER/ACCOUNTANT are fully free-form — effective permissions are exactly extra, nothing unioned in from ROLE_PERMISSIONS', () => {
    expect(effectivePermissions('MANAGER', [])).toEqual([]);
    expect(effectivePermissions('MANAGER', ['manage_users'])).toEqual(['manage_users']);
    expect(effectivePermissions('ACCOUNTANT', ['view_reports'])).toEqual(['view_reports']);
  });

  it('effectivePermissions de-dupes extra without adding anything else', () => {
    expect(effectivePermissions('MANAGER', ['view_reports', 'view_reports'])).toEqual(['view_reports']);
  });

  // Phase 32: view_dashboard/view_safes are Owner/Manager-only by default
  // (suggested-default state for Manager, hardcoded-full for Owner) —
  // Accountant/Employee must have them explicitly granted, same tier as
  // any other manage_* permission.
  it('ALL_PERMISSIONS includes view_dashboard and view_safes', () => {
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(['view_dashboard', 'view_safes']));
  });

  it('OWNER effective permissions include view_dashboard/view_safes automatically', () => {
    expect(effectivePermissions('OWNER', [])).toEqual(expect.arrayContaining(['view_dashboard', 'view_safes']));
  });

  it("MANAGER's suggested-default list includes view_dashboard/view_safes, but a MANAGER with no stored rows has neither at runtime (no accidental floor)", () => {
    expect(ROLE_PERMISSIONS.MANAGER).toEqual(expect.arrayContaining(['view_dashboard', 'view_safes']));
    expect(effectivePermissions('MANAGER', [])).toEqual([]);
    expect(effectivePermissions('MANAGER', ['view_dashboard', 'view_safes'])).toEqual([
      'view_dashboard',
      'view_safes',
    ]);
  });

  it('ACCOUNTANT gets no automatic view_dashboard/view_safes — must be granted explicitly', () => {
    expect(ROLE_PERMISSIONS.ACCOUNTANT).not.toEqual(expect.arrayContaining(['view_dashboard']));
    expect(ROLE_PERMISSIONS.ACCOUNTANT).not.toEqual(expect.arrayContaining(['view_safes']));
  });
});
