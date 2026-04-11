# Security Policy

## Supported Versions

The following versions of Cardinal currently receive security updates:

| Version | Supported |
| :--- | :--- |
| 2.0.x | ✅ |
| 1.1.x | ✅ |
| 1.0.x | ❌ |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

If you discover a potential security issue in Cardinal, please report it privately to our security team. We take all reports seriously and will work with you to resolve the issue as quickly as possible.

- **Email**: security@softcurse.com
- **Method**: Please include a detailed description of the vulnerability, reproduction steps, and any proof-of-concept code.

### Required Information
- **Description**: What is the nature of the vulnerability?
- **Reproduction**: How can we see the issue (step-by-step)?
- **Impact**: What is the potential risk to users?
- **Environment**: OS and Cardinal version.

## Response Timeline

- **Acknowledgement**: Within 48 hours.
- **Initial Assessment**: Within 7 days.
- **Patch/Mitigation**: Within 90 days of confirmation.
- **Disclosure**: Coordinated after a fix is released.

## Security Advisories

Confirmed vulnerabilities will be documented in the [GitHub Security Advisories](https://github.com/softcurse/cardinal/security/advisories) tab.

## Out of Scope

The following are not currently considered valid vulnerabilities:
- Social engineering or phishing attacks.
- Denial of Service (DoS) attacks on free-tier infrastructure.
- Issues related to non-standard or highly-customized Electron builds.

---

## Best Practices

- **Keep Dependencies Updated**: We regularly audit and update our `node_modules`.
- **Private Reporting**: Always use the designated security contact for sensitive issues.
- **No Secrets**: Never commit API keys or personal tokens to the codebase.
