#!/usr/bin/env perl
# Minimal static file server for local preview (core modules only).
use strict;
use warnings;
use IO::Socket::INET;
use File::Basename qw(dirname);
use File::Spec;

my $root = shift // '.';
my $port = shift // 8080;

my %mime = (
    html => 'text/html; charset=utf-8',
    htm  => 'text/html; charset=utf-8',
    css  => 'text/css; charset=utf-8',
    js   => 'application/javascript; charset=utf-8',
    svg  => 'image/svg+xml',
    png  => 'image/png',
    jpg  => 'image/jpeg',
    ico  => 'image/x-icon',
    json => 'application/json; charset=utf-8',
    txt  => 'text/plain; charset=utf-8',
);

my $server = IO::Socket::INET->new(
    LocalAddr => "127.0.0.1",
    LocalPort => $port,
    Listen    => 20,
    ReuseAddr => 1,
) or die "listen failed: $!";

print "serving $root on http://127.0.0.1:$port/\n";

while (my $client = $server->accept()) {
    $client->autoflush(1);
    my $request = <$client>;
    next unless defined $request;
    my ($method, $path) = $request =~ /^(\S+)\s+(\S+)/;
    $path = '/' unless defined $path;
    $path =~ s/\?.*//;
    $path =~ s/#.*//;
    $path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg;
    $path = '/' if $path eq '' or $path =~ m{^\.\.} or $path =~ m{/\.\.};
    $path = "/index.html" if $path eq '/';

    my $file = File::Spec->catfile($root, split m{/}, $path);
    if (-f $file && index(File::Spec->rel2abs($file), File::Spec->rel2abs($root)) == 0) {
        open my $fh, '<:raw', $file or do { _err($client, 500); close $client; next; };
        local $/;
        my $body = <$fh>;
        close $fh;
        my ($ext) = $file =~ /\.([a-z]+)$/i;
        my $type = $mime{lc($ext // '')} // 'application/octet-stream';
        print $client "HTTP/1.1 200 OK\r\nContent-Type: $type\r\nContent-Length: " .
            length($body) . "\r\nConnection: close\r\n\r\n$body";
    } else {
        _err($client, 404);
    }
    close $client;
}

sub _err {
    my ($c, $code) = @_;
    my $msg = $code == 404 ? 'Not found' : 'Error';
    print $c "HTTP/1.1 $code $msg\r\nContent-Type: text/plain\r\nContent-Length: " .
        length($msg) . "\r\nConnection: close\r\n\r\n$msg";
}
