// The Home Assistant attributes a slim state stands for, worked out again from what the slim state says: the
// builder's preview (admin/builder/haPreview.ts) and the demo (display/mockHa.ts) have no attributes, and use this to
// ask haCore.js which controls and which rows under an Entidad card the server would give. Only for drawing: the
// server decides every real action from the entity's live attributes.
import type { HaSlim } from './types';

export function attrsFromSlim(s: HaSlim): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  switch (s.d) {
    case 'light':
      a.supported_color_modes = s.onoff ? ['onoff'] : [...(s.ctMin ? ['color_temp'] : []), ...(s.col ? ['hs'] : []), ...(!s.ctMin && !s.col ? ['brightness'] : [])];
      if (s.ctMin) a.min_color_temp_kelvin = s.ctMin;
      if (s.ctMax) a.max_color_temp_kelvin = s.ctMax;
      break;
    case 'switch':
      if (s.pct !== undefined) a.supported_features = 1;
      break;
    case 'climate':
      a.hvac_modes = s.modes;
      if (s.fans) a.fan_modes = s.fans;
      break;
    case 'cover':
      // what the cover takes, when it said it does not take everything (a tilt-only cover: none of the four)
      a.supported_features = s.sf !== undefined ? s.sf || 128 : s.pos !== null ? 15 : 11;
      if (s.pos !== null) a.current_position = s.pos;
      if (s.readOnly) a.device_class = 'garage';
      else if (s.dc) a.device_class = s.dc;
      break;
    case 'valve':
      a.supported_features = s.pos !== null ? 15 : 3;
      if (s.pos !== null) a.current_position = s.pos;
      if (s.dc) a.device_class = s.dc;
      break;
    case 'select':
      a.options = s.opts;
      break;
    case 'sensor':
      if (s.unit) a.unit_of_measurement = s.unit;
      if (s.dc) a.device_class = s.dc;
      if (s.min !== undefined) a.min = s.min;
      if (s.max !== undefined) a.max = s.max;
      if (s.step !== undefined) a.step = s.step;
      if (s.box) a.mode = 'box';
      break;
    default:
      break;
  }
  return a;
}
