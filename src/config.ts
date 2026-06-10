import { ServerConfig, CandidateConfig } from '@jhgaylor/candidate-mcp-server';
import axios from 'axios';
import pdfParse from 'pdf-parse';
import * as cheerio from 'cheerio';

let candidateConfig: CandidateConfig | null = null;

async function getTextFromUrl(url: string) {
  try {
    // Fetch the content from URL
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'TextExtractor/1.0'
      }
    });

    // Determine content type from response headers
    const contentType = response.headers['content-type'] || '';
    let extractedText = '';

    if (contentType.includes('application/pdf')) {
      // Extract text from PDF
      const pdfData = await pdfParse(response.data);
      extractedText = pdfData.text;
    } else if (contentType.includes('text/html')) {
      // Extract text from HTML
      const $ = cheerio.load(response.data.toString());
      // Remove script and style elements
      $('script, style').remove();
      extractedText = $('body').text().trim().replace(/\s+/g, ' ');
    } else if (contentType.includes('application/json')) {
      // Extract text from JSON
      const jsonData = JSON.parse(response.data.toString());
      extractedText = JSON.stringify(jsonData, null, 2);
    } else if (contentType.includes('text/plain')) {
      // Extract text from plain text
      extractedText = response.data.toString();
    } else {
      // Default: try to convert to string
      extractedText = `Unsupported content type: ${contentType}. Raw content:\n${response.data.toString().substring(0, 1000)}...`;
    }

    return extractedText;
  } catch (error) {
    console.error('Error fetching remote content:', error);
    return "Error fetching remote content from " + url;
  }
}


function getServerConfig() {
  const serverConfig = new ServerConfig();

  serverConfig.contactEmail = 'jhgaylor@gmail.com';

  if (process.env.RESEND_API_KEY) {
    // Resend's SMTP interface; the from-address domain must be verified
    // in the Resend dashboard.
    serverConfig.smtpHost = 'smtp.resend.com';
    serverConfig.smtpPort = 465;
    serverConfig.smtpUser = 'resend';
    serverConfig.smtpPass = process.env.RESEND_API_KEY;
    serverConfig.fromAddress = process.env.EMAIL_FROM || 'AI Assistant <ai-assistant@updates.inevitable.fyi>';
  } else {
    serverConfig.mailgunApiKey = process.env.MAILGUN_API_KEY;
    serverConfig.mailgunDomain = 'mg.jakegaylor.com';
  }

  return serverConfig;
}

async function getCandidateConfig() {
  if (candidateConfig) {
    return candidateConfig;
  }

  candidateConfig = new CandidateConfig();
  candidateConfig.name = 'Jake Gaylor';
  candidateConfig.resumeUrl = 'https://jakegaylor.com/resume/';
  candidateConfig.resumeText = await getTextFromUrl("https://jakegaylor.com/resume.json");
  candidateConfig.linkedinUrl = 'https://linkedin.com/in/jhgaylor';
  candidateConfig.githubUrl = 'https://github.com/jhgaylor';
  candidateConfig.websiteUrl = 'https://jakegaylor.com';
  candidateConfig.websiteText = await getTextFromUrl("https://jakegaylor.com/") + "\n\n" + await getTextFromUrl("https://jakegaylor.com/bio");

  return candidateConfig;
}

export { getServerConfig, getCandidateConfig };