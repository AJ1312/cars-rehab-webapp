import type { Metadata } from 'next';
import { EnrolForm } from '@/components/play/EnrolForm';

export const metadata: Metadata = { title: 'Enrol this phone' };
export default function EnrolPage() { return <EnrolForm />; }
