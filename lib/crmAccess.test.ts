import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAccessCrmPage, getCrmApiPermission, hasCrmPermission, safeCrmRedirect } from './crmAccess';
import { getManagerRpcPermission, getManagerRpcTarget } from './crmManagerRpc';

test('manager sees only the requested sections and operational receipt pages', () => {
  for (const path of ['/orders', '/new-order', '/receipt/123', '/print/receipt', '/warehouse',
    '/finance/reconciliation', '/finance/overview', '/admin/stats', '/admin/team',
    '/admin/franchise-hq', '/admin/brandbook', '/admin/mobile-app', '/admin/employee-calendar', '/manager-plan']) {
    assert.equal(canAccessCrmPage('manager', path), true, path);
  }
  for (const path of ['/settings', '/settings/users', '/settings/payroll', '/taxes',
    '/warehouse/suppliers', '/warehouse/other', '/admin/budget', '/admin/frame-procurement',
    '/admin/lens-procurement', '/admin/ai-employee-messages', '/admin/whatsapp-control',
    '/admin/system-map', '/admin/franchise-map', '/admin/franchise-finance',
    '/settings/barcodes/overview', '/settings/lens-prices', '/finance/settings', '/admin/returns']) {
    assert.equal(canAccessCrmPage('manager', path), false, path);
    assert.equal(canAccessCrmPage('owner', path), true, path);
  }
});

test('URL variants cannot broaden manager permissions or redirect outside CRM', () => {
  for (const path of ['/warehouse%2fsuppliers', '/orders/../settings', '/orders\\..\\settings',
    '/orders//settings', '/orders%0a', '/orders%09', '/orders%252fsettings', '/orders%']) {
    assert.equal(canAccessCrmPage('manager', path), false, path);
  }
  for (const role of ['owner', 'manager', 'seller', null]) {
    for (const target of ['https://evil.example', '//evil.example', '/\n/evil.example',
      '/\t/evil.example', '/\\evil.example', '/%2f%2fevil.example']) {
      assert.equal(safeCrmRedirect(target, role), '/orders', String(target));
    }
  }
  assert.equal(safeCrmRedirect('/settings/payroll', 'manager'), '/orders');
  assert.equal(safeCrmRedirect('/orders?q=123', 'manager'), '/orders?q=123');
});

test('API permissions restrict endpoints and methods', () => {
  assert.equal(getCrmApiPermission('/api/dashboard', 'POST'), 'statistics');
  assert.equal(getCrmApiPermission('/api/manager/compensation', 'GET'), 'managerPlan');
  assert.equal(canAccessCrmPage('seller', '/manager-plan'), false);
  assert.equal(getCrmApiPermission('/api/admin/team/42', 'GET'), 'team360');
  for (const [path, method] of [['/api/payroll/data', 'GET'], ['/api/payroll/fixed', 'GET'], ['/api/admin/set-role', 'POST'],
    ['/api/admin/team/ai-comment', 'POST'], ['/api/employees', 'GET'], ['/api/dashboard', 'DELETE']]) {
    assert.equal(getCrmApiPermission(path, method), null);
  }
  assert.equal(hasCrmPermission(null, 'finance'), false);
  assert.equal(hasCrmPermission('seller', 'finance'), false);
});

test('privileged manager RPC proxy excludes administration and raw payroll', () => {
  assert.equal(getManagerRpcPermission('admin_period_by_branch'), 'statistics');
  assert.equal(getManagerRpcPermission('warehouse_accessory_set_counts'), 'warehouse');
  assert.equal(getManagerRpcTarget('admin_soft_delete_order'), 'crm_manager_admin_soft_delete_order');
  assert.equal(getManagerRpcTarget('warehouse_accessory_set_counts'), 'crm_manager_warehouse_set_counts');
  assert.equal(getManagerRpcTarget('admin_period_by_branch'), 'admin_period_by_branch');
  for (const name of ['payroll_daily_canonical', 'payroll_period_canonical', 'owner_payroll_daily_fixed', 'admin_users_list',
    'admin_hard_delete_order', 'lens_ondemand_pending_count', '__proto__', 'constructor']) {
    assert.equal(getManagerRpcPermission(name), null, name);
  }
});
