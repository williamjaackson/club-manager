function roleId(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;

  if (!/^\d{17,20}$/.test(value)) {
    throw new Error(`${name} must be a valid Discord role ID`);
  }

  return value;
}

export const rsvpEligibility = {
  connectedRoleId: roleId("STUDENT_CONNECTION_ROLE_ID", "1257896371973914674"),
  exemptRoleId: roleId("STUDENT_NUMBER_EXEMPT_ROLE_ID", "1343246871723901071"),
};
