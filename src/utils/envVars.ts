/**
 * Environment Variable Utilities
 * Extract and parse environment variables from AI responses
 */

export interface EnvVar {
  key: string;
  value: string;
  description: string;
  required: boolean;
}

/**
 * Extract environment variables from streaming content in .env format
 * This handles streaming content that contains environment variables
 */
export function extractEnvVarsFromContent(content: string): EnvVar[] {
  const envVars: EnvVar[] = [];

  // Cosmic environment variables that should be excluded (these are automatic)
  const cosmicEnvVars = [
    'COSMIC_BUCKET_SLUG',
    'COSMIC_READ_KEY',
    'COSMIC_WRITE_KEY',
    'COSMIC_API_URL',
    'COSMIC_BUCKET_ID',
  ];

  // Look for .env content in code blocks - use more flexible regex to catch different formats
  const envCodeBlockRegex = /```(?:bash|shell|env|text|dotenv|plaintext)?\s*\n([\s\S]*?)```/g;
  let match;

  while ((match = envCodeBlockRegex.exec(content)) !== null) {
    const envContent = match[1];

    // Parse individual environment variables
    const envLines = envContent
      .split('\n')
      .filter(
        (line) =>
          line.trim() &&
          !line.trim().startsWith('#') &&
          !line.trim().startsWith('//') &&
          line.includes('=')
      );

    envLines.forEach((line) => {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();

      if (key && value) {
        const trimmedKey = key.trim();

        // Skip Cosmic environment variables as they are automatic
        if (cosmicEnvVars.includes(trimmedKey)) {
          return;
        }

        // Skip if already added (deduplicate)
        if (envVars.some((v) => v.key === trimmedKey)) {
          return;
        }

        // Generate description based on common env var patterns
        const description = generateEnvVarDescription(trimmedKey);

        envVars.push({
          key: trimmedKey,
          value: value.trim().replace(/^["']|["']$/g, ''), // Remove quotes
          description,
          required: true,
        });
      }
    });
  }

  // Also check for inline environment variables (as a last resort)
  if (
    envVars.length === 0 &&
    (content.includes('env') ||
      content.includes('ENV') ||
      content.includes('environment variable')) &&
    content.includes('=')
  ) {
    const inlineEnvRegex = /(\w+)=([^\s<>]+)/g;
    let inlineMatch;

    while ((inlineMatch = inlineEnvRegex.exec(content)) !== null) {
      const [, key, value] = inlineMatch;

      if (key && value && key.length > 2 && !cosmicEnvVars.includes(key)) {
        // Only add if it looks like an environment variable
        if (
          key.includes('_') ||
          key.toUpperCase() === key ||
          key.includes('API') ||
          key.includes('URL') ||
          key.includes('KEY') ||
          key.includes('SECRET') ||
          key.includes('TOKEN')
        ) {
          // Skip if already added
          if (envVars.some((v) => v.key === key)) {
            continue;
          }

          const description = generateEnvVarDescription(key);

          envVars.push({
            key: key.trim(),
            value: value.trim().replace(/^["']|["']$/g, ''),
            description,
            required: true,
          });
        }
      }
    }
  }

  return envVars;
}

/**
 * Generate a description based on the environment variable key
 */
function generateEnvVarDescription(key: string): string {
  const lowerKey = key.toLowerCase();

  if (lowerKey.includes('resend')) {
    return 'Resend API key for email sending';
  } else if (lowerKey.includes('stripe')) {
    return 'Stripe API key for payments';
  } else if (lowerKey.includes('openai')) {
    return 'OpenAI API key for AI features';
  } else if (lowerKey.includes('anthropic')) {
    return 'Anthropic API key for AI features';
  } else if (lowerKey.includes('api') && lowerKey.includes('key')) {
    return 'API key for external service';
  } else if (lowerKey.includes('url')) {
    return 'URL endpoint';
  } else if (lowerKey.includes('key')) {
    return 'API key or secret';
  } else if (lowerKey.includes('secret')) {
    return 'Secret value';
  } else if (lowerKey.includes('token')) {
    return 'Access token';
  } else if (lowerKey.includes('password')) {
    return 'Password';
  } else if (lowerKey.includes('user')) {
    return 'Username';
  } else if (lowerKey.includes('host')) {
    return 'Host address';
  } else if (lowerKey.includes('port')) {
    return 'Port number';
  } else if (lowerKey.includes('database') || lowerKey.includes('db')) {
    return 'Database connection';
  } else if (lowerKey.includes('email') || lowerKey.includes('mail')) {
    return 'Email configuration';
  }

  return `Environment variable: ${key}`;
}

export default { extractEnvVarsFromContent };
