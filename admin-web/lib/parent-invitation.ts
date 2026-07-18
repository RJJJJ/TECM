export type ParentLinkIdentity = {
  id: string;
  organization_id: string;
  user_id: string | null;
};

export async function findAuthUserByEmail<T extends { email?: string | null }>(
  email: string,
  listPage: (page: number, perPage: number) => Promise<T[]>
): Promise<T | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const perPage = 100;
  for (let page = 1; ; page += 1) {
    const users = await listPage(page, perPage);
    const match = users.find((user) => user.email?.toLowerCase() === normalizedEmail);
    if (match || users.length < perPage) return match ?? null;
  }
}

export function hasConflictingParentLink(
  target: ParentLinkIdentity,
  authUserId: string | null,
  existingLinks: ParentLinkIdentity[]
) {
  if (target.user_id && target.user_id !== authUserId) return true;
  if (!authUserId) return false;
  return existingLinks.some(
    (link) => link.id !== target.id || link.organization_id !== target.organization_id
  );
}
