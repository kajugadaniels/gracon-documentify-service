/**
 * Seeds the document_templates table with the initial template library.
 * Run once after migration: npx ts-node src/seeds/templates.seed.ts
 * Safe to re-run — updates an existing template matched by name.
 */

import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeDatabaseUrl } from '../common/prisma/database-url.util';

const connectionString = process.env.DATABASE_URL;
const logger = new Logger('DocumentTemplatesSeed');

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: normalizeDatabaseUrl(connectionString),
  }),
});

const TEMPLATES = [
  {
    name: 'Service Agreement',
    description:
      'A professional service agreement between a service provider and a client. Includes scope of work, payment terms, and termination clauses.',
    category: 'CONTRACT',
    type: 'RICH_TEXT',
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Service Agreement' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This Service Agreement ("Agreement") is entered into on {{DATE}} between:',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'bold' }],
              text: 'Service Provider: ',
            },
            {
              type: 'text',
              text: '{{USER_FULL_NAME}} (Platform ID: {{USER_PLATFORM_ID}})',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Client: ' },
            { type: 'text', text: '[Client Full Name]' },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '1. Scope of Services' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The Service Provider agrees to deliver the following services: [Describe services clearly]',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '2. Payment Terms' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Total fee: [Amount] RWF. Payment schedule: [Schedule]',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '3. Duration' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This agreement commences on {{DATE}} and continues until [End Date] unless terminated earlier.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '4. Termination' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Either party may terminate this agreement with 30 days written notice.',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Agreed and signed by:' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '{{USER_FULL_NAME}} — Service Provider' },
          ],
        },
      ],
    },
  },
  {
    name: 'Non-Disclosure Agreement (NDA)',
    description:
      'A standard NDA protecting confidential information shared between two parties.',
    category: 'LEGAL',
    type: 'RICH_TEXT',
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Non-Disclosure Agreement' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Effective Date: {{DATE}}' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This Non-Disclosure Agreement ("Agreement") is entered into between {{USER_FULL_NAME}} ("Disclosing Party") and [Recipient Name] ("Receiving Party").',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '1. Confidential Information' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '"Confidential Information" means any non-public information disclosed by the Disclosing Party, including but not limited to: business plans, financial data, technical specifications, and client information.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '2. Obligations' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The Receiving Party agrees to: (a) hold all Confidential Information in strict confidence; (b) not disclose Confidential Information to third parties; (c) use Confidential Information solely for the purpose of [stated purpose].',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '3. Duration' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This Agreement shall remain in effect for [2] years from the Effective Date.',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Signed: {{USER_FULL_NAME}} — {{DATE}}' },
          ],
        },
      ],
    },
  },
  {
    name: 'Invoice',
    description:
      'A professional invoice for goods or services rendered. Auto-fills your verified name and Platform ID.',
    category: 'FINANCIAL',
    type: 'RICH_TEXT',
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'INVOICE' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'From: ' },
            { type: 'text', text: '{{USER_FULL_NAME}}' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Platform ID: ' },
            { type: 'text', text: '{{USER_PLATFORM_ID}}' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Invoice Date: ' },
            { type: 'text', text: '{{DATE}}' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Invoice #: ' },
            { type: 'text', text: '[INV-001]' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Bill To: ' },
            { type: 'text', text: '[Client Name and Address]' },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Services / Items' }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Description' }],
                    },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Quantity' }],
                    },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Unit Price (RWF)' }],
                    },
                  ],
                },
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'Total (RWF)' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        { type: 'text', text: '[Service description]' },
                      ],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: '1' }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: '0' }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: '0' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              marks: [{ type: 'bold' }],
              text: 'TOTAL: [Amount] RWF',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Payment due within 30 days of invoice date.',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Board Resolution',
    description:
      'A formal board resolution template for digital authority decisions, delegated signing, institutional stamps, and controlled execution.',
    category: 'RESOLUTION',
    type: 'RICH_TEXT',
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Board Resolution for Digital Authority' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Resolution of the Board of Directors of [Institution / Company Name]',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Date: {{DATE}}' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Prepared by: {{USER_FULL_NAME}} (Platform ID: {{USER_PLATFORM_ID}})',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '1. Meeting and Authority' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The Board of Directors, having reviewed the operational need for digital signing, institutional stamping, and controlled document execution, confirms that a duly convened meeting was held and that the board had quorum to pass this resolution.',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Meeting reference: [Meeting number / board session reference]',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Chairperson: [Chairperson full name]',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Secretary: [Secretary full name]',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '2. Purpose of the Resolution' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The purpose of this resolution is to grant and regulate digital authority for authorised representatives to prepare, review, sign, stamp, finalise, lock, and verify official documents through the Gracon 360 platform.',
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Approve the use of personal digital certificates for authorised signers.' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Approve institutional stamping for documents requiring institutional authority.' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Define controls for delegated authority, audit trails, revocation, and verification.' }],
                },
              ],
            },
          ],
        },
        { type: 'pageBreak' },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '3. Resolutions Passed' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'It is hereby resolved that the following digital authority controls are approved and adopted by the institution:',
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'The institution authorises [Authorised Signer Name] to sign official documents using a valid platform-issued certificate.' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'The institution authorises [Institution Admin / Stamp Officer] to request, manage, and apply institutional stamps where required.' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Any certificate revocation, authority removal, or stamp deactivation must be recorded with a clear reason and audit trail.' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Finalised documents must preserve verification references, content hashes, signer identity, certificate status, and stamp chain metadata.' }],
                },
              ],
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '4. Authorised Roles' }],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Role' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Person / Office' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Authority Scope' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Primary signer' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '[Full name]' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sign approved institutional documents' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stamp officer' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '[Full name]' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Apply institutional stamps after required approvals' }] }] },
              ],
            },
          ],
        },
        { type: 'pageBreak' },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '5. Validity and Review' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This authority becomes effective on {{DATE}} and remains valid until revoked, replaced, or superseded by a later board resolution. The authority must be reviewed at least annually or immediately after a material governance, security, or personnel change.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '6. Certification' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This resolution was passed by [unanimous vote / majority vote] of the Board and is certified as a true record of the decision.',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Certified by: {{USER_FULL_NAME}} — {{DATE}}',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Board Chairperson: ______________________________' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Secretary: ______________________________________' }],
        },
      ],
    },
  },
  {
    name: 'Employment Contract',
    description:
      'A standard employment contract defining role, compensation, and obligations for employer and employee.',
    category: 'CONTRACT',
    type: 'RICH_TEXT',
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Employment Contract' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This Employment Contract is entered into on {{DATE}} between:',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Employer: ' },
            { type: 'text', text: '[Company Name]' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Employee: ' },
            {
              type: 'text',
              text: '{{USER_FULL_NAME}} (Platform ID: {{USER_PLATFORM_ID}})',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '1. Position' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The Employee is hired as [Job Title] in the [Department] department.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '2. Commencement' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Employment commences on {{DATE}}.' },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '3. Compensation' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Monthly salary: [Amount] RWF, paid on the [Date] of each month.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '4. Working Hours' }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Standard hours: [Hours] per week, [Days] per week.',
            },
          ],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '5. Leave Entitlement' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Annual leave: [Days] days per year.' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Signed: {{USER_FULL_NAME}} — {{DATE}}' },
          ],
        },
      ],
    },
  },
];

async function main() {
  logger.log('Seeding document templates...');

  for (const template of TEMPLATES) {
    const existingTemplate = await prisma.documentTemplate.findFirst({
      where: { name: template.name },
      select: { id: true },
    });

    if (existingTemplate) {
      await prisma.documentTemplate.update({
        where: { id: existingTemplate.id },
        data: {
          description: template.description,
          category: template.category as never,
          type: template.type as never,
          contentJson: template.contentJson as never,
        },
      });
    } else {
      await prisma.documentTemplate.create({
        data: template as never,
      });
    }

    logger.log(`Seeded template: ${template.name}`);
  }

  logger.log(`${TEMPLATES.length} templates seeded successfully.`);
}

main()
  .catch((e) => {
    logger.error('Document template seed failed.', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
