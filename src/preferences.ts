// Structured screening data — the logistics every recruiter pipeline asks
// about before a human conversation happens. Served verbatim by the
// get_candidate_preferences MCP tool and the candidate-preferences A2A
// skill, and included in the about-jake LLM grounding. Edit values here;
// everything downstream picks them up on the next build.
const candidatePreferences = {
  candidate: 'Jake Gaylor',
  role_types: [
    'Staff / Senior Platform Engineer',
    'AI & Agent Infrastructure Engineer',
    'Engineering Leader',
  ],
  target_level: 'Senior / Staff / Lead',
  location: 'Boston, MA, USA',
  relocation: true,
  remote: 'open to remote or Boston-area onsite; will relocate for the right role',
  work_authorization: 'authorized to work in the United States',
  compensation: 'negotiable — share your range',
  earliest_start: 'ask — send a CONTACT: message with the role details',
  contact:
    'A2A: send a message starting with "CONTACT:" including a reply address. MCP: use the contact_candidate tool.',
  resume_json: 'https://jakegaylor.com/resume.json',
  resume_markdown: 'https://ai.jakegaylor.com/llms.txt',
  links: {
    website: 'https://jakegaylor.com',
    github: 'https://github.com/jhgaylor',
    linkedin: 'https://linkedin.com/in/jhgaylor',
  },
};

export { candidatePreferences };
