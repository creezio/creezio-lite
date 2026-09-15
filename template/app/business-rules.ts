import type { BeforeWrite } from '@/creezio/core/index';
// Add product-specific validation here. Throw ApiError for actionable errors.
// Cross-record invariants need a database constraint/atomic batch in a custom route.
export const beforeWrite: BeforeWrite = () => {};
