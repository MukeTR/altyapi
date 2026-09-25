import type trTeam from "../tr/team";

const team: typeof trTeam = {
  title: "Team",
  meta: "Members of {organization} and their roles.",
  membersTitle: "Members",
  membersDescription: "{count} records",
  empty: "No members yet",
  you: "You",
  readOnly: "Only people with the member management permission can change members and roles.",
  columns: {
    member: "Member",
    status: "Status",
    roles: "Roles",
  },
  scope: {
    label: "Scope",
    all: "All stores",
  },
  unknownStore: "Store {id}…",
  role: "Role",
  roles: "Roles",
  roleN: "Role {n}",
  scopeN: "Scope {n}",
  addGrant: "Add role",
  removeGrant: "Remove role {n}",
  ownerOnly: "Only organization owners can grant the organization owner role.",
  editRoles: "Edit roles",
  editRolesFor: "Edit roles for {name}",
  editRolesTitle: "Edit roles",
  editRolesDescription: "Choose the roles for {name} and which stores each role covers.",
  rolesReplaceNote: "Saving replaces all of the member's roles with this list. The organization's last owner cannot be removed.",
  rolesSaved: "Roles saved for {name}",
  invite: "Invite member",
  inviteTitle: "Invite member",
  inviteDescription: "When the invited person accepts with an account using this e-mail address, they join with the roles you choose.",
  inviteSubmit: "Create invitation",
  inviteDeliveryTitle: "Invitation e-mails are not sent yet",
  inviteDeliveryBody: "The invitation is created, stays valid for 7 days and is listed as “Invited”. The invitation link will be delivered once e-mail notifications are switched on; until then the person cannot accept it.",
  email: "E-mail",
  invited: "Invitation created for {email}",
};

export default team;
