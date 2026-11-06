// Fixed vocabularies (must match the CHECK constraints in 0003_insights_data_capture.sql).
export const CLIENT_TYPES = [
  ['manufacturing', 'Manufacturing'], ['engineering', 'Engineering firm'], ['automotive', 'Automotive'],
  ['mining', 'Mining'], ['agriculture', 'Agriculture'], ['healthcare', 'Healthcare / medical'],
  ['education', 'Education / university'], ['government', 'Government / SOE'], ['retail', 'Retail / consumer brand'],
  ['business', 'Other business (SME)'], ['startup', 'Startup'], ['student', 'Student'], ['individual', 'Individual / hobbyist'],
  ['other', 'Other'],
];
export const LEAD_SOURCES = [
  ['website', 'Website'], ['referral', 'Referral / word of mouth'], ['repeat', 'Existing client'], ['whatsapp', 'WhatsApp'],
  ['google', 'Google search / Maps'], ['social', 'Social media'], ['email', 'Email'], ['phone', 'Phone call'],
  ['walk_in', 'Walk-in'], ['event', 'Event / expo'], ['other', 'Other'],
];
export const LOST_REASONS = [
  ['price', 'Price too high'], ['turnaround', 'Turnaround too slow'], ['went_elsewhere', 'Went with someone else'],
  ['no_response', 'Client stopped responding'], ['scope_changed', 'Scope or design changed'],
  ['client_cancelled', 'Client cancelled the project'], ['not_feasible', 'Not feasible / we declined'], ['other', 'Other'],
];
export const ENQUIRY_SOURCES = [
  ['website', 'Website form'], ['whatsapp', 'WhatsApp'], ['phone', 'Phone'], ['email', 'Email'], ['walk_in', 'Walk-in'],
  ['referral', 'Referral'], ['social', 'Social media'], ['other', 'Other'],
];
export const TURNED_AWAY_REASONS = [
  ['not_offered', "We don't offer this"], ['capacity', 'No capacity / too busy'], ['too_small', 'Job too small'],
  ['outside_area', 'Outside our area'], ['not_viable', 'Not technically viable'], ['other', 'Other'],
];
export const ENQUIRY_STATUS = [
  ['new', 'New'], ['quoted', 'Quoted'], ['turned_away', 'Turned away'], ['no_response', 'No response'], ['spam', 'Spam'],
];
export const labelOf = (list, key) => (list.find(([k]) => k === key) || [key, key || 'Not recorded'])[1];
export const withBlank = (list, blank = 'Not set') => [['', blank], ...list];
