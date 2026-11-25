function ascii(text, length) {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < Math.min(text.length, length); i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

export const XRDML_LIST = `<?xml version="1.0" encoding="UTF-8"?>
<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/2.1">
  <sample><id>syn-xrd-id</id><name>Synthetic XRD list</name></sample>
  <xrdMeasurement measurementType="Scan" status="Completed">
    <usedWavelength intended="K-Alpha 1"><kAlpha1 unit="Angstrom">1.5406</kAlpha1><kAlpha2 unit="Angstrom">1.5444</kAlpha2><ratioKAlpha2KAlpha1>0.5</ratioKAlpha2KAlpha1></usedWavelength>
    <incidentBeamPath><xRayTube name="Synthetic Cu"><tension unit="kV">45</tension><current unit="mA">30</current><anodeMaterial>Cu</anodeMaterial></xRayTube></incidentBeamPath>
    <scan appendNumber="2" mode="Continuous" scanAxis="2Theta-Omega" status="Completed">
      <header><startTimeStamp>2026-01-02T03:04:05+00:00</startTimeStamp><author><name>Fixture Author</name></author><source><instrumentID>SYN-001</instrumentID></source></header>
      <dataPoints>
        <positions axis="Omega" unit="deg"><listPositions>0.5 0.6 0.7 0.8</listPositions></positions>
        <positions axis="2Theta" unit="deg"><listPositions>10 11 12 13</listPositions></positions>
        <positions axis="Phi" unit="deg"><commonPosition>0.25</commonPosition></positions>
        <counts unit="counts">20 40 60 80</counts>
        <beamAttenuationFactors>1 2 1 0.5</beamAttenuationFactors>
      </dataPoints>
    </scan>
  </xrdMeasurement>
</xrdMeasurements>`;

export const XRDML_RANGE = `<?xml version="1.0" encoding="UTF-8"?>
<xrd:xrdMeasurement xmlns:xrd="http://www.xrdml.com/XRDMeasurement/2.1" measurementType="Scan">
  <xrd:usedWavelength><xrd:kAlpha1 unit="Angstrom">1.5406</xrd:kAlpha1></xrd:usedWavelength>
  <xrd:scan mode="Step" scanAxis="Omega">
    <xrd:dataPoints>
      <xrd:positions axis="Omega" unit="deg"><xrd:startPosition>20</xrd:startPosition><xrd:endPosition>24</xrd:endPosition></xrd:positions>
      <xrd:intensities unit="a.u.">5 6 7</xrd:intensities>
      <xrd:counts unit="counts">999 999 999</xrd:counts>
    </xrd:dataPoints>
  </xrd:scan>
</xrd:xrdMeasurement>`;

export const XRDML_COMMON_ONLY = `<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/2.1"><xrdMeasurement><scan scanAxis="2Theta"><dataPoints><positions axis="2Theta" unit="deg"><commonPosition>10</commonPosition></positions><counts>1 2</counts></dataPoints></scan></xrdMeasurement></xrdMeasurements>`;
export const XRDML_BAD_LENGTH = XRDML_LIST.replace('20 40 60 80', '20 40 60');
export const XRDML_BAD_XML = '<xrdMeasurements><xrdMeasurement></xrdMeasurements>';
export const XRDML_ENTITY = '<!DOCTYPE xrdMeasurements [<!ENTITY x "1">]><xrdMeasurements>&x;</xrdMeasurements>';

export const RAS_TEXT = `*RAS_DATA_START
*RAS_HEADER_START
*FILE_SAMPLE "Synthetic RAS"
*FILE_MEMO "Known-answer fixture"
*DISP_TITLE_Y "Intensity"
*DISP_UNIT_Y "cps"
*HW_XG_TARGET_NAME "Cu"
*HW_XG_WAVE_LENGTH_ALPHA1 "1.540593"
*HW_XG_WAVE_LENGTH_ALPHA2 "1.544414"
*MEAS_COND_XG_VOLTAGE "40"
*MEAS_COND_XG_CURRENT "44"
*MEAS_SCAN_AXIS_X "2-Theta"
*MEAS_SCAN_MODE "CONTINUOUS"
*MEAS_SCAN_START "10"
*MEAS_SCAN_STOP "14"
*MEAS_SCAN_STEP "1"
*MEAS_SCAN_SPEED "2"
*MEAS_SCAN_SPEED_UNIT "deg/min"
*MEAS_SCAN_UNIT_X "deg"
*MEAS_SCAN_UNIT_Y "counts"
*MEAS_SCAN_START_TIME "2026/01/02 03:04:05"
*MEAS_SCAN_END_TIME "2026/01/02 03:05:05"
*MEAS_DATA_COUNT "5"
*RAS_HEADER_END
*RAS_INT_START
10 100 2
11 120 4
12 0 0
broken
13 80 1
*RAS_INT_END
*RAS_DATA_END
`;

export const RAS_TWO_COLUMN = RAS_TEXT.replace('10 100 2\n11 120 4\n12 0 0\nbroken\n13 80 1', '10 100\n11 120\n12 90\n13 80\n14 70').replace('*MEAS_DATA_COUNT "5"', '*MEAS_DATA_COUNT "5"');

export function makeSPA(options = {}) {
  const values = options.values || [1, 2, 3, 4];
  const count = options.count ?? values.length;
  const headerLength = options.headerLength ?? 140;
  const header = new Uint8Array(headerLength);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(4, count, true);
  header[8] = options.xUnit ?? 0x01;
  header[12] = options.yUnit ?? 0x11;
  if (header.length >= 24) {
    headerView.setFloat32(16, options.lastX ?? 100, true);
    headerView.setFloat32(20, options.firstX ?? 400, true);
  }
  if (xUnitIsRaman(header[8]) && header.length >= 100) headerView.setFloat32(96, options.laserWavenumber ?? 15798, true);

  const payload = new Uint8Array(values.length * 4 + (options.payloadExtra || 0));
  const payloadView = new DataView(payload.buffer);
  values.forEach((value, index) => payloadView.setFloat32(index * 4, value, true));
  const blocks = [];
  if (!options.omitHeader) blocks.push({ key: 0x02, subtype: 0, data: header });
  if (options.duplicateHeader) blocks.push({ key: 0x02, subtype: 0, data: header });
  if (!options.omitPayload) blocks.push({ key: 0x03, subtype: 0, data: payload });
  if (options.duplicatePayload) blocks.push({ key: 0x03, subtype: 0, data: payload });
  if (options.comment !== null) {
    const comment = ascii(options.comment ?? 'Synthetic SPA comment', 64);
    blocks.push({ key: 0x04, subtype: 0, data: comment });
  }
  if (options.experiment !== false) {
    const experiment = new Uint8Array(700);
    experiment.set(ascii(options.experimentPath ?? 'C:\\fixtures\\synthetic.spa', 80), 10);
    experiment.set(ascii(options.title ?? 'Synthetic SPA title', 64), 90);
    experiment.set(ascii(options.description ?? 'Known-answer binary fixture', 259), 154);
    experiment.set(ascii(options.accessory ?? 'Synthetic accessory', 257), 413);
    blocks.push({ key: 0x82, subtype: 0x79, data: experiment });
  }
  blocks.push({ key: 0x6a, subtype: 0, data: new Uint8Array(56) });
  if (options.library) blocks.push({ key: 0x53, subtype: 0, data: ascii('Library variant', 32) });

  const tableEnd = 304 + blocks.length * 16;
  let cursor = tableEnd;
  blocks.forEach(block => {
    cursor = Math.ceil(cursor / 4) * 4;
    block.position = cursor;
    cursor += block.data.length;
  });
  const file = new Uint8Array(cursor);
  file.set(ascii('Spectral Data File', 18), 0);
  file.set(ascii(options.savedName ?? 'Saved synthetic name', 256), 30);
  const view = new DataView(file.buffer);
  view.setUint16(294, blocks.length, true);
  view.setUint32(296, options.timestamp ?? 0, true);
  blocks.forEach((block, index) => {
    const offset = 304 + index * 16;
    file[offset] = block.key;
    file[offset + 1] = block.subtype;
    view.setUint32(offset + 2, block.position, true);
    view.setUint32(offset + 6, block.data.length, true);
    file.set(block.data, block.position);
  });
  if (options.badPointer) view.setUint32(306, file.length - 1, true);
  if (options.overlapPayload) {
    const headerIndex = blocks.findIndex(block => block.key === 0x02);
    const payloadIndex = blocks.findIndex(block => block.key === 0x03);
    if (headerIndex >= 0 && payloadIndex >= 0) view.setUint32(304 + payloadIndex * 16 + 2, blocks[headerIndex].position, true);
  }
  return file;
}

function xUnitIsRaman(code) {
  return code === 0x20;
}
