// Barrel exports for the mobile workspace + departments primitives.
export { OrgSwitcher } from './OrgSwitcher';
export { OrgSwitcherTrigger } from './OrgSwitcherTrigger';
export { OrgSwitcherSheet } from './OrgSwitcherSheet';
export { useOrgMemberships } from './useOrgMemberships';
export type { UseOrgMembershipsApi, UseOrgMembershipsState } from './useOrgMemberships';

// Department picker (cross-platform sync — mirrors web DepartmentPickerField).
export { DepartmentPickerSheet } from './DepartmentPickerSheet';
export { useDepartments } from './useDepartments';
export type { MobileDepartment, UseDepartmentsApi } from './useDepartments';
