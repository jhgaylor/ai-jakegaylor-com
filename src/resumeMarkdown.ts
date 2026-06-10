// Renders a JSON Resume (https://jsonresume.org) document as markdown.
// The canonical resume lives at jakegaylor.com/resume.json (maintained in
// the jhgaylor.github.io repo); converting it at boot keeps this site's
// copy-paste resume block and /llms.txt from drifting out of date.

function formatDate(yearMonth?: string): string {
  if (!yearMonth) return 'Present';
  const [year, month] = yearMonth.split('-').map(Number);
  if (!year) return 'Present';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return month ? `${months[month - 1]} ${year}` : `${year}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonResumeToMarkdown(resume: any): string {
  const lines: string[] = [];
  const basics = resume.basics || {};

  lines.push(`# ${basics.name || 'Jake Gaylor'}`);
  if (basics.label) lines.push(`## ${basics.label}`);

  const contact = [
    basics.email,
    basics.phone,
    basics.url,
    ...(basics.profiles || []).map((p: { url?: string }) => p.url),
  ].filter(Boolean).join(' | ');
  if (contact) lines.push(contact);
  if (basics.location?.region) lines.push(basics.location.region);

  if (basics.summary) {
    lines.push('', '## Summary', basics.summary);
  }

  if (resume.work?.length) {
    lines.push('', '## Professional Experience');
    for (const job of resume.work) {
      lines.push('', `### ${job.name} | ${job.position} | ${formatDate(job.startDate)} - ${formatDate(job.endDate)}`);
      if (job.url) lines.push(job.url);
      if (job.summary) lines.push(job.summary);
      for (const highlight of job.highlights || []) {
        lines.push(`- ${highlight}`);
      }
    }
  }

  if (resume.skills?.length) {
    lines.push('', '## Skills');
    for (const skill of resume.skills) {
      const level = skill.level ? ` (${skill.level})` : '';
      lines.push('', `### ${skill.name}${level}`, (skill.keywords || []).join(', '));
    }
  }

  if (resume.projects?.length) {
    lines.push('', '## Projects');
    for (const project of resume.projects) {
      lines.push('', `### ${project.name}`);
      if (project.url) lines.push(project.url);
      if (project.description) lines.push(project.description);
      for (const highlight of project.highlights || []) {
        lines.push(`- ${highlight}`);
      }
    }
  }

  if (resume.references?.length) {
    lines.push('', '## References');
    for (const ref of resume.references) {
      lines.push('', `"${ref.reference}" - ${ref.name}`);
    }
  }

  return lines.join('\n');
}

export { jsonResumeToMarkdown };
