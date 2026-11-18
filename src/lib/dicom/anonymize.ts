/**
 * Header anonymisation based on the DICOM Basic Application Level
 * Confidentiality Profile (PS3.15 Annex E).
 *
 * Rather than encoding the profile's full attribute table, broad rules by VR
 * cover whole classes of attributes (every date, time, person name, free-text
 * field and UID), and explicit lists cover the identifying attributes with
 * other VRs. Pixel data is never changed, so text burned into the image stays.
 */
import dcmjs, { type DicomDataset, type DicomElement } from 'dcmjs'

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjs.data

/** Keywords (not tags) keep the lists readable; a unit test checks each one resolves. */
const REMOVE_KEYWORDS = [
  // Patient
  'IssuerOfPatientID',
  'IssuerOfPatientIDQualifiersSequence',
  'OtherPatientIDs',
  'OtherPatientIDsSequence',
  'PatientBirthTime',
  'PatientAge',
  'PatientSize',
  'PatientWeight',
  'PatientAddress',
  'PatientTelephoneNumbers',
  'PatientInsurancePlanCodeSequence',
  'PatientPrimaryLanguageCodeSequence',
  'PatientReligiousPreference',
  'PatientSexNeutered',
  'PatientState',
  'PatientInstitutionResidence',
  'ReferencedPatientPhotoSequence',
  'EthnicGroup',
  'Occupation',
  'MilitaryRank',
  'BranchOfService',
  'MedicalRecordLocator',
  'MedicalAlerts',
  'Allergies',
  'CountryOfResidence',
  'RegionOfResidence',
  'SmokingStatus',
  'PregnancyStatus',
  'SpecialNeeds',
  'ResponsibleOrganization',
  // Visit, order and procedure step
  'AdmissionID',
  'AdmittingDiagnosesDescription',
  'AdmittingDiagnosesCodeSequence',
  'ServiceEpisodeID',
  'ServiceEpisodeDescription',
  'CurrentPatientLocation',
  'PlacerOrderNumberImagingServiceRequest',
  'FillerOrderNumberImagingServiceRequest',
  'RequestingService',
  'RequestedProcedureDescription',
  'RequestedProcedureID',
  'RequestAttributesSequence',
  'ScheduledProcedureStepDescription',
  'ScheduledProcedureStepID',
  'PerformedProcedureStepID',
  'PerformedProcedureStepDescription',
  'PerformedLocation',
  'PerformedStationName',
  'ReferencedStudySequence',
  'ReferencedPatientSequence',
  'ReferencedPerformedProcedureStepSequence',
  // Institution, staff and equipment
  'InstitutionName',
  'InstitutionCodeSequence',
  'InstitutionalDepartmentName',
  'ReferringPhysicianTelephoneNumbers',
  'ReferringPhysicianIdentificationSequence',
  'PhysiciansOfRecordIdentificationSequence',
  'PerformingPhysicianIdentificationSequence',
  'PhysiciansReadingStudyIdentificationSequence',
  'OperatorIdentificationSequence',
  'StationName',
  'DeviceSerialNumber',
  'DetectorID',
  'PlateID',
  'CassetteID',
  'GantryID',
  'TimezoneOffsetFromUTC',
  // Descriptions that may hold names or other free text
  'StudyDescription',
  'SeriesDescription',
  'ProtocolName',
  'ContrastBolusAgent',
  'AcquisitionDeviceProcessingDescription',
  'DerivationDescription',
  // Embedded or derived content
  'ContentSequence',
  'AcquisitionContextSequence',
  'IconImageSequence',
  'OriginalAttributesSequence',
  'ModifiedAttributesSequence',
  'DigitalSignaturesSequence',
  'DataSetTrailingPadding',
  'StorageMediaFileSetID',
]

/** Type 2 attributes, kept with an empty value so required modules stay valid. */
const EMPTY_KEYWORDS = ['AccessionNumber', 'StudyID', 'PatientSex']

/** UIDs that name a standard or a SOP class rather than an instance. */
const KEEP_UID_KEYWORDS = [
  'SOPClassUID',
  'ReferencedSOPClassUID',
  'MediaStorageSOPClassUID',
  'TransferSyntaxUID',
  'ImplementationClassUID',
  'CodingSchemeUID',
  'RelatedGeneralSOPClassUID',
  'OriginalSpecializedSOPClassUID',
]

const WELL_KNOWN_UID_PREFIX = '1.2.840.10008.'

/** Free text, network addresses and elements of unknown type: always removed. */
const REMOVE_VRS = new Set(['LT', 'ST', 'UT', 'UC', 'AE', 'UN'])
/** Dates, times and person names: kept, but emptied. */
const EMPTY_VRS = new Set(['DA', 'DT', 'TM', 'PN'])

export function keywordToTag(keyword: string): string | undefined {
  return DicomMetaDictionary.nameMap[keyword]?.tag.replace(/[(),]/g, '').toUpperCase()
}

function tagSet(keywords: string[]): Set<string> {
  return new Set(keywords.map(keywordToTag).filter((tag): tag is string => !!tag))
}

const REMOVE_TAGS = tagSet(REMOVE_KEYWORDS)
const EMPTY_TAGS = tagSet(EMPTY_KEYWORDS)
const KEEP_UID_TAGS = tagSet(KEEP_UID_KEYWORDS)

export const PROFILE_KEYWORDS = {
  remove: REMOVE_KEYWORDS,
  empty: EMPTY_KEYWORDS,
  keepUid: KEEP_UID_KEYWORDS,
}

const PATIENT_NAME = '00100010'
const PATIENT_ID = '00100020'
const SOP_INSTANCE_UID = '00080018'
const MEDIA_STORAGE_SOP_INSTANCE_UID = '00020003'
const TRANSFER_SYNTAX_UID = '00020010'
const DEFLATED_EXPLICIT_LITTLE_ENDIAN = '1.2.840.10008.1.2.1.99'
const EXPLICIT_LITTLE_ENDIAN = '1.2.840.10008.1.2.1'
/** File meta elements naming the sending and receiving systems. */
const META_REMOVE = ['00020016', '00020017', '00020018', '00020100', '00020102']

const METHOD = 'Basic Application Confidentiality Profile'

/** A fresh UID under the UUID-derived root 2.25 (PS3.5 B.2). */
export function randomUid(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  return `2.25.${BigInt(`0x${hex}`)}`
}

function randomPatientId(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  return `ANON-${hex.toUpperCase()}`
}

function element(vr: string, Value: unknown[]): DicomElement {
  return { vr, Value }
}

function isPrivate(tag: string): boolean {
  return parseInt(tag.slice(0, 4), 16) % 2 === 1
}

/** Curves (50xx) and overlays (60xx), which can hold drawn-on text. */
function isCurveOrOverlay(tag: string): boolean {
  return tag.startsWith('50') || tag.startsWith('60')
}

export interface Anonymizer {
  /** Anonymise one Part 10 file. Throws if it cannot be parsed. */
  anonymize(file: ArrayBuffer): ArrayBuffer
}

/**
 * Create an anonymiser for one export. UIDs and patient IDs are replaced
 * consistently across every file it processes, so the output still groups
 * into the same patients, studies and series, and references between
 * instances still resolve.
 */
export function createAnonymizer(): Anonymizer {
  const uids = new Map<string, string>()
  const patientIds = new Map<string, string>()

  const mapUid = (uid: string) => {
    if (uid.startsWith(WELL_KNOWN_UID_PREFIX)) return uid
    let mapped = uids.get(uid)
    if (!mapped) {
      mapped = randomUid()
      uids.set(uid, mapped)
    }
    return mapped
  }

  const patientId = (dataset: DicomDataset) => {
    const original = String(dataset[PATIENT_ID]?.Value?.[0] ?? '')
    let mapped = patientIds.get(original)
    if (!mapped) {
      mapped = randomPatientId()
      patientIds.set(original, mapped)
    }
    return mapped
  }

  function clean(dataset: DicomDataset) {
    for (const [tag, el] of Object.entries(dataset)) {
      if (
        isPrivate(tag) ||
        isCurveOrOverlay(tag) ||
        REMOVE_TAGS.has(tag) ||
        REMOVE_VRS.has(el.vr)
      ) {
        delete dataset[tag]
      } else if (EMPTY_TAGS.has(tag) || EMPTY_VRS.has(el.vr)) {
        dataset[tag] = element(el.vr, [])
      } else if (el.vr === 'UI' && !KEEP_UID_TAGS.has(tag)) {
        dataset[tag] = element('UI', (el.Value ?? []).map((uid) => mapUid(String(uid))))
      } else if (el.vr === 'SQ') {
        for (const item of (el.Value ?? []) as DicomDataset[]) clean(item)
      }
    }
  }

  return {
    anonymize(file) {
      const { meta, dict } = DicomMessage.readFile(file)
      const pseudonym = patientId(dict)

      clean(dict)
      dict[PATIENT_NAME] = element('PN', [{ Alphabetic: pseudonym }])
      dict[PATIENT_ID] = element('LO', [pseudonym])
      dict[keywordToTag('PatientIdentityRemoved')!] = element('CS', ['YES'])
      dict[keywordToTag('DeidentificationMethod')!] = element('LO', [METHOD])
      dict[keywordToTag('DeidentificationMethodCodeSequence')!] = element('SQ', [
        {
          '00080100': element('SH', ['113100']),
          '00080102': element('SH', ['DCM']),
          '00080104': element('LO', [METHOD]),
        },
      ])
      dict[keywordToTag('LongitudinalTemporalInformationModified')!] = element('CS', [
        'REMOVED',
      ])

      for (const tag of META_REMOVE) delete meta[tag]
      const sopInstanceUid = dict[SOP_INSTANCE_UID]?.Value?.[0]
      if (sopInstanceUid) {
        meta[MEDIA_STORAGE_SOP_INSTANCE_UID] = element('UI', [sopInstanceUid])
      }
      // dcmjs inflates deflated datasets on read but cannot deflate on write.
      if (meta[TRANSFER_SYNTAX_UID]?.Value?.[0] === DEFLATED_EXPLICIT_LITTLE_ENDIAN) {
        meta[TRANSFER_SYNTAX_UID] = element('UI', [EXPLICIT_LITTLE_ENDIAN])
      }

      const out = new DicomDict(meta)
      out.dict = dict
      return out.write()
    },
  }
}

/** The header fields `mayHaveBurnedInText` looks at. */
export interface BurnedInHints {
  modality: string
  sopClassUID: string
  burnedInAnnotation: string
}

/** Modalities whose images routinely carry on-screen text. */
const TEXT_PRONE_MODALITIES = new Set(['US', 'XC', 'ES', 'OT', 'DOC', 'SM'])
const SECONDARY_CAPTURE_PREFIX = '1.2.840.10008.5.1.4.1.1.7'

/**
 * Whether an image may show identifying text in its pixels, which header
 * anonymisation does not touch. An explicit BurnedInAnnotation wins;
 * otherwise screenshots and text-prone modalities are flagged.
 */
export function mayHaveBurnedInText({
  modality,
  sopClassUID,
  burnedInAnnotation,
}: BurnedInHints): boolean {
  const declared = burnedInAnnotation.trim().toUpperCase()
  if (declared === 'YES') return true
  if (declared === 'NO') return false
  return (
    TEXT_PRONE_MODALITIES.has(modality.toUpperCase()) ||
    sopClassUID.startsWith(SECONDARY_CAPTURE_PREFIX)
  )
}
