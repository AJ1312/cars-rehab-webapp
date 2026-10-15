import { apiStaff, isResponse } from '@/lib/server/auth';
import { dictionaryCsv, downloadHeaders } from '@/lib/server/export';

export async function GET(req: Request) {
  const staff = await apiStaff(req, 'therapist');
  if (isResponse(staff)) return staff;
  return new Response(dictionaryCsv(), { headers: downloadHeaders('CARS_data_dictionary.csv', 'text/csv; charset=utf-8') });
}
