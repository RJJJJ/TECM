# AI Provider Selection

This comparison is guidance only and does not claim exact pricing.

| Option | Strengths | Risks | Best fit |
| --- | --- | --- | --- |
| OpenAI | Strong JSON/instruction following, good Traditional Chinese, mature ecosystem | Requires credential management and usage monitoring | Default candidate for structured output workflow |
| Gemini | Good general model option and ecosystem fit for some teams | JSON reliability should be validated for this prompt | Candidate if team already uses Google tooling |
| Local model via HTTP | More control over data path and cost profile | More ops burden, weaker JSON reliability possible | Candidate when privacy/control outweigh simplicity |
| Other provider placeholder | Allows vendor flexibility | Unknown output quality and support | Evaluate with same schema and safety checklist |

## Evaluation dimensions

- JSON reliability
- Traditional Chinese quality
- latency
- operational simplicity
- credential management in n8n
- privacy considerations

All provider credentials should live in n8n credentials or protected environment variables, not workflow JSON or repo files.
