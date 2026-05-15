REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_default_time_category() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_subscription_row() FROM PUBLIC, anon, authenticated;