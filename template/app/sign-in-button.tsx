"use client";
import { useEffect, useState } from 'react';
import { Button } from '@creezio/shell-ui/ui/kit';
export function SignInButton() {
  const [href,setHref]=useState('/signin-with-chatgpt?return_to=%2F');
  useEffect(()=>{if(/^#invite=[a-f0-9]{64}$/.test(location.hash))setHref('/signin-with-chatgpt?return_to='+encodeURIComponent('/'+location.hash));},[]);
  return <Button asChild size="lg"><a href={href} target="_top">Se connecter avec ChatGPT</a></Button>;
}
