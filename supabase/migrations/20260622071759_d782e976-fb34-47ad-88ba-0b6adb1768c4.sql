
CREATE POLICY "Public read receipts" ON storage.objects FOR SELECT USING (bucket_id = 'receipts');
CREATE POLICY "Public upload receipts" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'receipts');
CREATE POLICY "Public update receipts" ON storage.objects FOR UPDATE USING (bucket_id = 'receipts') WITH CHECK (bucket_id = 'receipts');
CREATE POLICY "Public delete receipts" ON storage.objects FOR DELETE USING (bucket_id = 'receipts');
