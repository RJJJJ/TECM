export type ParentLinkIdentity = {
  id: string;
  organization_id: string;
  user_id: string | null;
};

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
