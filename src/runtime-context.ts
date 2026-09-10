export const runtimeContext = {
  allowedTools: undefined as string[] | undefined,
  permissionMode: undefined as string | undefined,
};

export function isCommandAllowed(command: string, allowedTools: string[]): boolean {
  if (allowedTools.includes('Bash') || allowedTools.includes('shell')) {
    return true;
  }

  const trimmedCmd = command.trim();

  for (const pattern of allowedTools) {
    const match = pattern.match(/^(?:Bash|shell)\((.*)\)$/i);
    if (match) {
      const cmdPattern = match[1].trim();
      
      // If the pattern contains wildcards '*', we do a regex/wildcard match
      if (cmdPattern.includes('*')) {
        const escapedPattern = cmdPattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*');
        const regex = new RegExp(`^${escapedPattern}$`);
        if (regex.test(trimmedCmd)) {
          return true;
        }
      } else {
        // Prefix/exact match:
        // Matches if command is exactly the pattern, or starts with pattern followed by a space
        if (trimmedCmd === cmdPattern || trimmedCmd.startsWith(cmdPattern + ' ')) {
          return true;
        }
      }
    }
  }
  return false;
}
