import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 48,
    color: '#111827',
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
    paddingBottom: 16,
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
  },
  brandName: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  brandTagline: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
  },
  invoiceMeta: {
    textAlign: 'right',
  },
  invoiceTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 4,
  },
  metaLine: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomColor: '#f3f4f6',
    borderBottomWidth: 1,
  },
  rowLabel: {
    color: '#374151',
    flex: 1,
  },
  rowValue: {
    color: '#111827',
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    marginTop: 4,
    borderTopColor: '#111827',
    borderTopWidth: 1,
  },
  totalLabel: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  totalValue: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  footer: {
    marginTop: 40,
    paddingTop: 12,
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    fontSize: 8,
    color: '#9ca3af',
    textAlign: 'center',
  },
})

export interface InvoiceDocProps {
  invoiceNumber: string
  bookingRef: string
  serviceDate: string
  jobTitle: string
  category: string
  providerName: string
  customerName: string
  labourCost: number
  materialsCost: number
  totalAmount: number
  currency?: string
}

function formatAmount(cents: number, currency = 'ZAR'): string {
  return `${currency === 'ZAR' ? 'R' : currency} ${cents.toFixed(2)}`
}

export function InvoiceDocument({
  invoiceNumber,
  bookingRef,
  serviceDate,
  jobTitle,
  category,
  providerName,
  customerName,
  labourCost,
  materialsCost,
  totalAmount,
  currency = 'ZAR',
}: InvoiceDocProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandName}>Plug A Pro</Text>
            <Text style={styles.brandTagline}>Service Invoice</Text>
          </View>
          <View style={styles.invoiceMeta}>
            <Text style={styles.invoiceTitle}>Invoice #{invoiceNumber}</Text>
            <Text style={styles.metaLine}>Booking ref: {bookingRef}</Text>
            <Text style={styles.metaLine}>Date: {serviceDate}</Text>
          </View>
        </View>

        {/* Parties */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Provider</Text>
            <Text>{providerName}</Text>
          </View>
          <View style={[styles.section, { textAlign: 'right' }]}>
            <Text style={styles.sectionTitle}>Billed to</Text>
            <Text>{customerName}</Text>
          </View>
        </View>

        {/* Service details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Service details</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Service</Text>
            <Text style={styles.rowValue}>{jobTitle || category}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Category</Text>
            <Text style={styles.rowValue}>{category}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Date</Text>
            <Text style={styles.rowValue}>{serviceDate}</Text>
          </View>
        </View>

        {/* Line items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cost breakdown</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Labour</Text>
            <Text style={styles.rowValue}>{formatAmount(labourCost, currency)}</Text>
          </View>
          {materialsCost > 0 && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Materials</Text>
              <Text style={styles.rowValue}>{formatAmount(materialsCost, currency)}</Text>
            </View>
          )}
        </View>

        {/* Total */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatAmount(totalAmount, currency)}</Text>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          This invoice is issued by Plug A Pro on behalf of the service provider.{'\n'}
          Thank you for using Plug A Pro.
        </Text>
      </Page>
    </Document>
  )
}
